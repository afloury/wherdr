<script setup lang="ts">
// Animated preview of quoted replies (Settings › Conversation), drawn in
// CSS with the theme colors: "↳ Reply" on a question, its token in the
// field, the answer typed, a second quote, then the message sent (the
// conversation moves up to it, the field empties); in a loop.
// Reduced motion: the composed field, still.
</script>

<template>
  <figure class="qt-preview" aria-hidden="true">
    <figcaption>{{ t('Preview') }}</figcaption>
    <div class="qt-stage">
      <div class="qt-conv">
        <div class="qt-agent">
          <p>{{ tl('Tea or coffee?', 'Thé ou café ?') }} <span class="qt-tag one">↳ {{ t('Reply') }}</span></p>
          <p>{{ tl('And your favorite series?', 'Et ta série préférée ?') }} <span class="qt-tag two">↳ {{ t('Reply') }}</span></p>
        </div>
        <div class="qt-sent">
          <span class="qt-sent-q">{{ tl('Tea or coffee?', 'Thé ou café ?') }}</span>
          <span>{{ tl('Coffee.', 'Café.') }}</span>
          <span class="qt-sent-q">{{ tl('And your favorite series?', 'Et ta série préférée ?') }}</span>
          <span>Lost !</span>
        </div>
      </div>
      <div class="qt-field">
        <span class="qt-ph">{{ tl('Message to Claude…', 'Message à Claude…') }}</span>
        <span class="qt-tok one"><b>↳</b>{{ tl('Tea or coffee?', 'Thé ou café ?') }}<i>✕</i></span>
        <span class="qt-ans one">{{ tl('Coffee.', 'Café.') }}</span>
        <span class="qt-tok two"><b>↳</b>{{ tl('And your favorite series?', 'Et ta série préférée ?') }}<i>✕</i></span>
        <span class="qt-ans two">Lost !</span>
        <span class="qt-send">↑</span>
      </div>
    </div>
  </figure>
</template>
