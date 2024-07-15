import type { Observable } from 'rxjs'
import {
  firstValueFrom,
  ReplaySubject,
  Subscription,
  interval,
  partition,
  take,
  map,
  filter,
  Subject,
  lastValueFrom,
} from 'rxjs'
import { Message, MessageToSend, Msg, Receiver, SynAck, SynAckMessage, UserMessage } from './adapters'

type MessageEvent<T = unknown> = globalThis.MessageEvent<T> | ExtendableMessageEvent

type MessageEventWithData<T = unknown> =
  (Omit<globalThis.MessageEvent<T>, 'data'> | Omit<ExtendableMessageEvent, 'data'>) & {data: T & Message}

// and the sender has methods to listen
interface Sender {
  addEventListener(type: 'message', listener: (message: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (message: MessageEvent) => void): void
}

type Listener<S extends MessageToSend> = (this: PostChannel<S>, message: MessageToSend) => void

interface PostChannelOptions<S extends MessageToSend = MessageToSend> {
  from: Sender
  instance?: string
  log?: (this: PostChannel<S>, message: S) => void
  period?: number
  to: Receiver
}

const synackKeys = Object.values(SynAck)

const msgKeys = Object.values(Msg)

const getData = (message: MessageEventWithData<Message>) => message.data

const synackFilter = (type: SynAck) => (data: Message): data is SynAckMessage =>
  data.type === type

const isPostChannelMessage = (message: MessageEvent): message is MessageEventWithData<SynAckMessage> | MessageEventWithData<UserMessage> => {
  const data = message.data as unknown
  return typeof data === 'object'
    && data !== null
    && 'type' in data
    && typeof data.type === 'string'
    && [...synackKeys, ...msgKeys].includes(data.type as SynAck | Msg)
    && 'instance' in data
    && typeof data.instance === 'string'
    && 'content' in data
}

class PostChannel<S extends MessageToSend = MessageToSend> {
  private static __generateId = () => {
    if (window) {
      return window.crypto.randomUUID()
    } else {
      return (require('crypto') as Crypto).randomUUID()
    }
  }
  static utils = {
    isPostChannelMessage,
  }

  private __instance: string
  private __sender: Sender
  private __listener: Listener<S>
  private __log: ((this: PostChannel<S>, message: S) => void) | undefined
  private __receiver: Receiver
  private __handler: (message: MessageEvent<unknown>) => void
  private __subscription: Subscription
  private __okToWrite: ReplaySubject<string>
  private __write$: Observable<string>
  private __synack$: Observable<SynAckMessage>
  private __user$: Observable<UserMessage>

  private __connect(period: number) {
    /**
     *  A                                    B
     *  |                                    |
     *  |  Syn (content: A, instance: A) =>  |
     *  |                                    |
     *  |  <- Ack (content: A, instance: B)  |
     *  |                                    |
     *
     *  from A point of view:
     *    1. start sending syn requests
     *    2. at first matching ack stops sending syn and filters
     *       recv by foreign instance and removing syn/ack discussion
     *
     *  from B point of view:
     *    1. listens to incoming syn request
     *    2. as soon as it gets one it replies with ack
     */

    // ================== A =====================
    // attempt to connect to other end
    // by sending a 'syn'
    const synSubscription = interval(period)
      .subscribe(() => this.__receiver.postMessage({
        content: this.__instance,
        instance: this.__instance,
        type: SynAck.Syn,
      }))
    this.__subscription.add(synSubscription)

    this.__subscription.add(
      this.__user$
        .subscribe(async (message) => {
          const foreignInstance = await lastValueFrom(this.__okToWrite.pipe(take(1)))
          if (message.instance === foreignInstance) {
            this.__listener(message.content)
            if (message._id !== undefined) {
              // ============== ACK SEND ==================
              /**
               * when message is sent including an _id string
               * it means a receipt acknowledgment is required
               */
              this.__receiver.postMessage({ content: message._id, instance: this.__instance, type: SynAck.Ack })
            }
          }
        })
    )

    // await for other end to 'syn-ack' previout 'syn'
    this.__subscription.add(
      this.__synack$.pipe(
        filter(synackFilter(SynAck.Ack)),
        filter(({ content }) => content === this.instance),
        take(1)
      ).subscribe(({ instance: foreignInstance }) => {
        // on 'syn-ack' send a final ack
        // from now on this side is sure to be
        // able to write to the other end
        this.__okToWrite.next(foreignInstance)
        synSubscription.unsubscribe()
      })
    )

    // ================== B =====================
    this.__subscription.add(
      this.__synack$.pipe(
        // must check whether is not short-circuiting
        // in an infinite loop by syncing with itself
        filter(synackFilter(SynAck.Syn)),
        filter(({ instance: foreignInstance }) => foreignInstance !== this.instance),
        take(1)
      ).subscribe(({ content }) => {
        this.__receiver.postMessage({ content, instance: this.instance, type: SynAck.Ack })
      })
    )
  }

  private __write(message: S, _id?: string) {
    this.__subscription.add(
      this.__write$.subscribe(() => {
        const outgoingMessage = {
          _id,
          content: message,
          instance: this.__instance,
          type: Msg.Msg,
        }
        this.__receiver.postMessage(outgoingMessage)
        this.__log?.(message)
      })
    )
  }

  constructor(listener: Listener<S>, opts: PostChannelOptions<S>) {
    const events = new Subject<MessageEvent<unknown>>()

    this.__instance = opts.instance ?? PostChannel.__generateId()
    this.__listener = listener

    this.__sender = opts.from
    this.__receiver = opts.to
    this.__handler = (message) => events.next(message)

    this.__log = opts.log && opts.log.bind(this)
    this.__subscription = new Subscription()

    this.__sender.addEventListener('message', this.__handler)
    const [synackMessages, userMessages] = partition(
      events.pipe(filter(isPostChannelMessage), map(getData)),
      (message): message is SynAckMessage => synackKeys.includes(message.type as SynAck)
    )
    this.__synack$ = synackMessages
    this.__user$ = userMessages

    this.__okToWrite = new ReplaySubject(1)
    this.__write$ = this.__okToWrite.pipe(take(1))

    // period cannot be zero!
    this.__connect(
      opts?.period ? opts.period : 10
    )
  }

  disconnect() {
    this.__subscription.unsubscribe()
    this.__sender.removeEventListener('message', this.__handler)
  }

  send(message: S) {
    this.__write(message)
  }

  ackSend(message: S) {
    let done: () => void
    const promise = new Promise<void>((resolve) => { done = resolve })
    const messageId = PostChannel.__generateId()

    this.__subscription.add(
      this.__synack$.pipe(
        filter(synackFilter(SynAck.Ack)),
        filter(({ content }) => content === messageId),
        take(1)
      ).subscribe(() => done())
    )
    this.__write(message, messageId)
    return promise
  }

  get instance() {
    return this.__instance
  }

  /**
   * signals readiness on listening and cannot fail but keeps hanging
   * if not resolved
   */
  get ready(): Promise<void> {
    return firstValueFrom(this.__write$).then(() => { /* no-op */ })
  }
}

export type {
  Listener,
  Message,
  MessageToSend,
  MessageEventWithData,
  PostChannelOptions,
  Receiver,
  Sender,
}

const createPostChannel = <S extends MessageToSend = MessageToSend>(listener: Listener<S>, opts: PostChannelOptions<S>) => {
  const channel = new PostChannel(listener, opts)
  return channel.ready.then(() => channel)
}

export { createPostChannel }
export * from './adapters'
