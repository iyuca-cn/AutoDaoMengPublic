import { ref } from "vue";

export function useRemoteResource<T>() {
  const data = ref<T | null>(null);
  const loading = ref(false);
  const error = ref("");

  async function run(loader: () => Promise<T>): Promise<T | null> {
    loading.value = true;
    error.value = "";
    try {
      data.value = await loader();
      return data.value;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, run };
}
