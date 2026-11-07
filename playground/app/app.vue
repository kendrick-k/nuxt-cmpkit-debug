<template>
  <main style="font-family: system-ui; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
    <h1>nuxt-cmpkit-debug playground</h1>
    <p>Open the CMP button at the bottom left.</p>
    <CmpkitDebug />
  </main>
</template>

<script setup lang="ts">
// A demo key: the widget loads, the project does not exist, which is enough to see the panel.
useHead({ script: [{ src: 'https://cmpkit.com/widget.js', defer: true, 'data-api-key': 'demo-public-key-1234', 'data-load-strategy': 'idle' }] })
</script>
