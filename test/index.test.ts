import { test } from 'mocha'
import { Listener, MessageToSend, createPostChannel, Receiver, Sender, adapters } from '../src'
import { ReplaySubject } from 'rxjs'

test('ciao', async () => {
  const listener: Listener<MessageToSend> = function (this, message) {
    const { instance } = this
    console.log(`${instance} received: ${JSON.stringify(message)}`)
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
    createPostChannel(listener, { from: windowListener, to: postToWorker, instance: 'mainThread' }),
    createPostChannel(listener, { from: workerListener, to: postToWindow, instance: 'worker' })
  ])

  workerChannel.send({ type: 'ciao from worker', content: {} })
  windowChannel.send({ type: 'ciao from window', content: {} })
})
