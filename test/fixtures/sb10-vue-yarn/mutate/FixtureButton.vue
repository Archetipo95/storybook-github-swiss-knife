<script setup>
defineProps({ label: { type: String, required: true }, background: { type: String, default: '#b91c1c' } });
</script>

<template>
  <button type="button" :style="{ background, color: '#ffffff', border: 0, padding: '12px 20px', font: '16px sans-serif' }">
    {{ label }}
  </button>
</template>
