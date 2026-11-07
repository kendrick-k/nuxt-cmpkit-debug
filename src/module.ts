import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'

export interface ModuleOptions {
  /** Where the button sits on the screen edge. */
  position: 'left' | 'right'
}

export default defineNuxtModule<ModuleOptions>({
  meta: { name: 'nuxt-cmpkit-debug', configKey: 'cmpkitDebug', compatibility: { nuxt: '>=3.15.0' } },
  defaults: { position: 'left' },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    nuxt.options.runtimeConfig.public.cmpkitDebug = { position: options.position }
    // In a production build the component is an empty stub: no panel code is shipped.
    addComponent({
      name: 'CmpkitDebug',
      filePath: resolve(nuxt.options.dev ? './runtime/components/CmpkitDebug.vue' : './runtime/components/CmpkitDebugStub.vue'),
    })
  },
})
