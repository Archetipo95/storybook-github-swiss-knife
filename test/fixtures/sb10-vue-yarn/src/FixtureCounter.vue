<script setup>
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <div style="font: 16px sans-serif; color: #0f172a">
    <p>Count: {{ count }}</p>
    <button type="button" @click="count += 1">Increment</button>
  </div>
</template>
