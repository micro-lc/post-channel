import { test } from 'mocha'
import { ReplaySubject } from 'rxjs'

import type { Listener, MessageToSend, Receiver, Sender } from '..'
import { createPostChannel } from '..'


test('both ends of the post channel should exchange a message after successful syn/ack', async () => {
  let resolveWindow: () => void
  let resolveWorker: () => void
  const doneWindow = new Promise<void>((resolve) => {
    resolveWindow = resolve
  })
  const doneWorker = new Promise<void>((resolve) => {
    resolveWorker = resolve
  })
  const listenerWindow: Listener<MessageToSend> = () => {
    resolveWindow()
  }
  const listenerWorker: Listener<MessageToSend> = () => {
    resolveWorker()
  }

  const windowBuffer = new ReplaySubject()
  const workerBuffer = new ReplaySubject()

  // on main thread listens to 'messages'
  const windowListener: Sender = {
    addEventListener: (_, listener) => {
      windowBuffer.asObservable().subscribe((msg) => listener(new MessageEvent('message', { data: msg })))
    },
    removeEventListener: () => { /* no-op */ },
  }
  // handler to send to worker
  const postToWorker: Receiver = {
    postMessage: (message) => workerBuffer.next(message),
  }

  const workerListener: Sender = {
    addEventListener: (_, listener) => {
      workerBuffer.asObservable().subscribe((msg) => listener(new MessageEvent('message', { data: msg })))
    },
    removeEventListener: () => { /* no-op */ },
  }
  // handler to send to window
  const postToWindow: Receiver = {
    postMessage: (message) => windowBuffer.next(message),
  }

  const [windowChannel, workerChannel] = await Promise.all([
    createPostChannel(listenerWindow, { from: windowListener, instance: 'mainThread', to: postToWorker }),
    createPostChannel(listenerWorker, { from: workerListener, instance: 'worker', to: postToWindow }),
  ])

  workerChannel.send({ content: {}, type: 'hello from worker' })
  windowChannel.send({ content: {}, type: 'hello from window' })

  return Promise.all([doneWindow, doneWorker])
})
