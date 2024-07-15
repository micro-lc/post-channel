enum Msg {
  Msg = 'msg'
}

type MessageToSend = {
  content: unknown
  type: string
}

type UserMessage = {
  _id?: string
  content: MessageToSend
  instance: string
  type: Msg
}

enum SynAck {
  Ack = 'ack',
  Syn = 'syn'
}

interface SynAckMessage {
  content: string
  instance: string
  type: SynAck
}

type Message = SynAckMessage | UserMessage

// despite weird, the receiver has a postMessage method
interface Receiver<T extends Message = Message> {
  postMessage: (message: T) => void
}

interface Client {
  postMessage(message: unknown, options?: StructuredSerializeOptions): void
}

interface Clients {
  get(id: string): Promise<Client | undefined>
}

/**
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/postMessage}
 */
interface ServiceWorkerGlobalScopePostMessage {
  readonly clients: Clients
}

interface ServiceWorkerAdapterOptions extends StructuredSerializeOptions {
  errorCatcher?: (clientId: string, message: Message) => (error: unknown) => void
}

const fromServiceWorkerToReceiver = <T extends Message = Message>(
  self: ServiceWorkerGlobalScopePostMessage, options?: ServiceWorkerAdapterOptions
) => (clientId: string): Receiver<T> => ({
    postMessage: (message: T) => {
      const { errorCatcher = () => () => { /* no-op */ }, ...rest } = options ?? {}
      self.clients.get(clientId)
        .then((client) => client?.postMessage(message, rest))
        .catch(errorCatcher(clientId, message))
    },
  })

/**
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage}
 */
interface WindowPostMessage {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void
}

const fromWindowToReceiver = <T extends Message = Message>(self: WindowPostMessage, options?: WindowPostMessageOptions): Receiver<T> => {
  return {
    postMessage: (message: T) => {
      self.postMessage(message, options?.targetOrigin ?? '*', options?.transfer)
    },
  }
}

const adapters = {
  fromChild(window: Window) {
    return {
      from: window,
      to: fromWindowToReceiver(window.parent),
    }
  },
  fromParent(iframe: HTMLIFrameElement) {
    if (iframe.contentWindow) {
      if (iframe.ownerDocument.defaultView) {
        return {
          from: iframe.ownerDocument.defaultView,
          to: fromWindowToReceiver(iframe.contentWindow),
        }
      }
      throw new TypeError('iframe ownerDocument.defaultView is null')
    }
    throw new TypeError('iframe contentWindow is null')
  },
  fromServiceWorkerToReceiver,
  fromWindowToReceiver,
}

export type { Receiver, Message, MessageToSend, UserMessage, SynAckMessage }
export { adapters, SynAck, Msg }
