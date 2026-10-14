/// <reference types="vite/client" />

import type { VoxTermAPI } from '@shared/api'

declare global {
  interface Window {
    voxterm: VoxTermAPI
  }
}

export {}
