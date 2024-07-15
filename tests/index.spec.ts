import test from "@playwright/test";
import type * as PostChannel from '../src/index'

declare global {
  interface Window {
    PostChannel: typeof PostChannel
  }
}

const IFRAME_INSTANCE = 'iframe'
const WINDOW_INSTANCE = 'main'

test('window and child iframe should exchange messages after successful syn/ack', async ({page}) => {
  await page.goto("http://localhost:5173")

  // mounts an iframe which attempts to connect to
  // the parent window
  await page.evaluate(async (iframeInstance) => {
    const iframe = document.createElement('iframe')
    iframe.srcdoc = `
      <!DOCTYPE html>
      <html>
        <head><title>${iframeInstance}</title></head>
        <body>
          <script async type="module">
            import {createPostChannel, adapters} from "/src/index.ts"
            const {from, to} = adapters.fromChild(window)
            const ch = await createPostChannel(() => {}, { from, to, instance: '${iframeInstance}', log: console.log })
            ch.send({ type: 'hello from iframe' })
          </script>
        </body>
      </html>
    `
    document.body.appendChild(iframe)
  }, IFRAME_INSTANCE)

  // starts channel on main window and awaits for
  // 1. a message from iframe
  // 2. a successful `ackSend`
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
    const postChannel = await createPostChannel(listener, {from, to, instance: WINDOW_INSTANCE, log: console.log})

    await done

    await postChannel.ackSend({ type: 'hello' })
  })

})
