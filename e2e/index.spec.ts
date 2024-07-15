import test from "@playwright/test";
import type * as PostChannel from '../src/index'

declare global {
  interface Window {
    PostChannel: typeof PostChannel
  }
}

test('ciao', async ({page}) => {
  await page.goto("http://localhost:5173")
  await page.evaluate(async () => {
    let promiseResolve: () => void
    const done = new Promise<void>((resolve) => {
      promiseResolve = resolve
    })
    const listener = (msg: unknown) => {
      console.log(msg)
      promiseResolve()
    }
    const {PostChannel: {createPostChannel, adapters}} = window
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    const {from, to} = adapters.fromParent(iframe)
    const postChannel = await createPostChannel(listener, {from, to, instance: 'main', log: console.log})

    await done

    await postChannel.ackSend({ type: 'pippo' })
  })

})
