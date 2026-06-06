<script lang="ts" setup>
const props = defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  headline: { type: String, default: '' },
})

const title = computed(() => (props.title || '').slice(0, 60))
const description = computed(() => (props.description || '').slice(0, 160))
</script>

<template>
  <div class="w-full h-full flex flex-col justify-between bg-[#020420] overflow-hidden relative p-16">
    <!-- Green glow top-right -->
    <svg
      class="absolute right-0 top-0 opacity-60"
      width="629"
      height="593"
      viewBox="0 0 629 593"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g filter="url(#filter0_f_199_94966)">
        <path
          d="M628.5 -578L639.334 -94.4223L806.598 -548.281L659.827 -87.387L965.396 -462.344L676.925 -74.0787L1087.69 -329.501L688.776 -55.9396L1160.22 -164.149L694.095 -34.9354L1175.13 15.7948L692.306 -13.3422L1130.8 190.83L683.602 6.50012L1032.04 341.989L668.927 22.4412L889.557 452.891L649.872 32.7537L718.78 511.519L628.5 36.32L538.22 511.519L607.128 32.7537L367.443 452.891L588.073 22.4412L224.955 341.989L573.398 6.50012L126.198 190.83L564.694 -13.3422L81.8734 15.7948L562.905 -34.9354L96.7839 -164.149L568.224 -55.9396L169.314 -329.501L580.075 -74.0787L291.604 -462.344L597.173 -87.387L450.402 -548.281L617.666 -94.4223L628.5 -578Z"
          fill="#00DC82"
        />
      </g>
      <defs>
        <filter
          id="filter0_f_199_94966"
          x="0.873535"
          y="-659"
          width="1255.25"
          height="1251.52"
          filterUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feFlood
            flood-opacity="0"
            result="BackgroundImageFix"
          />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          />
          <feGaussianBlur
            stdDeviation="40.5"
            result="effect1_foregroundBlur_199_94966"
          />
        </filter>
      </defs>
    </svg>

    <!-- Top: brand name -->
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-lg bg-green-400 flex items-center justify-center">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="12"
            cy="12"
            r="3"
            fill="#020420"
          />
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4a1 1 0 110 2 1 1 0 010-2zm0 12a1 1 0 110-2 1 1 0 010 2zM6 12a1 1 0 11-2 0 1 1 0 012 0zm14 0a1 1 0 11-2 0 1 1 0 012 0z"
            fill="#020420"
          />
        </svg>
      </div>
      <span class="text-[28px] font-bold text-white tracking-tight">nuxt-realtime</span>
    </div>

    <!-- Middle: page content -->
    <div class="flex flex-col gap-5 max-w-3xl">
      <p
        v-if="headline"
        class="uppercase text-[20px] text-green-400 font-semibold tracking-widest m-0"
      >
        {{ headline }}
      </p>
      <h1
        v-if="title"
        class="m-0 text-[68px] font-bold text-white leading-tight"
      >
        {{ title }}
      </h1>
      <p
        v-if="description"
        class="m-0 text-[26px] text-[#94A3B8] leading-snug"
      >
        {{ description }}
      </p>
    </div>

    <!-- Bottom: tagline + repo -->
    <div class="flex items-center justify-between">
      <p class="text-[20px] text-green-400 font-medium m-0">
        Real-time state synchronization for Nuxt
      </p>
      <span class="text-[18px] text-[#475569] m-0">github.com/daanvangeloven/nuxt-realtime</span>
    </div>
  </div>
</template>
