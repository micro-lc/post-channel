import { test } from 'mocha'
import { Listener, MessageToSend, createPostChannel, Receiver, Sender, adapters } from '..'
import { ReplaySubject } from 'rxjs'

test('both ends of the post channel should exchange a message after successful syn/ack', async () => {
  let resolveWindow: () => void
  let resolveWorker: () => void
  const doneWindow = new Promise<void>((resolve) => {
    resolveWindow = resolve
  })
  const doneWorker = new Promise<void>((resolve) => {
    resolveWorker = resolve
  })
  const listenerWindow: Listener<MessageToSend> = function (this, message) {
    const { instance } = this
    // console.debug(`${instance} received: ${JSON.stringify(message)}`)
    resolveWindow()
  }
  const listenerWorker: Listener<MessageToSend> = function (this, message) {
    const { instance } = this
    // console.debug(`${instance} received: ${JSON.stringify(message)}`)
    resolveWorker()
  }

  const windowBuffer = new ReplaySubject()
  const workerBuffer = new ReplaySubject()

  // on main thread listens to 'messages'
  const windowListener: Sender = {
    addEventListener: (_, listener) => {
      windowBuffer.asObservable().subscribe((msg) => listener(new MessageEvent('message', { data: msg })))
    },
    removeEventListener: () => { },
  }
  // handler to send to worker
  const postToWorker: Receiver = {
    postMessage: (message) => workerBuffer.next(message)
  }

  const workerListener: Sender = {
    addEventListener: (_, listener) => {
      workerBuffer.asObservable().subscribe((msg) => listener(new MessageEvent('message', { data: msg })))
    },
    removeEventListener: () => { },
  }
  // handler to send to window
  const postToWindow: Receiver = {
    postMessage: (message) => windowBuffer.next(message)
  }

  const [windowChannel, workerChannel] = await Promise.all([
    createPostChannel(listenerWindow, { from: windowListener, to: postToWorker, instance: 'mainThread' }),
    createPostChannel(listenerWorker, { from: workerListener, to: postToWindow, instance: 'worker' })
  ])

  workerChannel.send({ type: 'hello from worker', content: {} })
  windowChannel.send({ type: 'hello from window', content: {} })

  return Promise.all([doneWindow, doneWorker])
})
