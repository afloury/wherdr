<script setup lang="ts">
// The Board with nothing kept on this device yet, while herdr-projects is read
// (BoardView, after 300 ms): the tools row's room, the real column heads with "—"
// for their counts, and a few empty cards of a card's exact size. On a phone, the
// group tabs. Static: no shimmer, no pulse.
import type { TaskGroup } from '#shared/projectsTasks'

const props = defineProps<{ wide: boolean, groups: TaskGroup[] }>()
// Cards per column: enough to read as a board, never a count.
const CARDS: Record<TaskGroup, number> = { needs: 1, ready: 1, working: 2, todo: 3, done: 1 }
const cols = computed(() => `repeat(${props.groups.length}, minmax(0, 1fr))`)
</script>

<template>
  <div class="board-skel" aria-hidden="true">
    <div class="board-tools"><span class="skel-tools" /></div>
    <div v-if="!wide" class="board-seg tasks" :style="{ gridTemplateColumns: `${cols} auto` }">
      <span v-for="(g, i) in groups" :key="g" class="board-seg-btn" :class="[g, { on: i === 0 }]"><span>{{ taskGroupLabel(g) }}</span><b>—</b></span>
      <span v-if="!groups.includes('done')" class="board-seg-btn board-done-toggle"><span>{{ taskGroupLabel('done') }}</span><b>—</b></span>
    </div>
    <div class="board-grid" :class="{ desk: wide }" :style="{ '--board-cols': cols }">
      <div v-if="wide" class="board-grid-head">
        <h3 v-for="g in groups" :key="g" class="board-col-head" :class="g"><span>{{ taskGroupLabel(g) }}</span><span class="pp-count">—</span></h3>
      </div>
      <div class="board-cols board-cells">
        <section v-for="g in (wide ? groups : groups.slice(0, 1))" :key="g" class="board-col" :class="g">
          <div class="board-col-body">
            <div v-for="n in (wide ? CARDS[g] : 3)" :key="n" class="board-card skel-card">
              <i style="width: 22%" /><i style="width: 78%" /><i style="width: 48%" />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
