import { ref, watch, type Ref } from 'vue'
import { resolveDeviceUrl } from '~/lib/device-files'
import { displayablePhotoUrl, isDeviceUrl, type PhotoRef, type PhotoSize } from '~/lib/photo-url'

/**
 * PhotoImg's picture: the address for its <img>, and `failed` (show the placeholder as unavailable). Looked up again only
 * when the url, the renditions or the size change, each compared on its own: views rebuild the PhotoRef objects on every
 * write, and a device photo would flash the placeholder while its object URL is looked up again.
 */
export function usePhotoSrc(props: { readonly photo: PhotoRef; readonly size: PhotoSize }): {
  src: Ref<string | null>
  failed: Ref<boolean>
} {
  const src = ref<string | null>(null)
  const failed = ref(false)
  watch(
    [() => props.photo.url, () => props.photo.urls, () => props.size],
    ([url, urls, size]) => {
      failed.value = false
      const shown = displayablePhotoUrl({ url, urls }, size)
      if (shown === null) {
        // Not one of the photo stores and not on the device: never loaded.
        src.value = null
        failed.value = true
        return
      }
      if (!isDeviceUrl(url)) {
        src.value = shown
        return
      }
      src.value = null
      void resolveDeviceUrl(url).then((resolved) => {
        // Ignore an answer for a url the component has moved on from.
        if (props.photo.url !== url) return
        if (resolved === null) failed.value = true
        else src.value = resolved
      })
    },
    { immediate: true },
  )
  return { src, failed }
}
