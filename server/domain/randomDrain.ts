export interface RandomDrainPreviewInput {
  threshold: number;
  jitter: number;
  seed?: string;
}

export interface RandomDrainPreview {
  supported: false;
  reason: string;
  input: RandomDrainPreviewInput;
}

export function previewRandomDrain(input: RandomDrainPreviewInput): RandomDrainPreview {
  if (!Number.isInteger(input.threshold) || input.threshold <= 0) {
    throw new Error("阈值必须是正整数");
  }
  if (!Number.isInteger(input.jitter) || input.jitter < 0) {
    throw new Error("偏移必须是非负整数");
  }
  return {
    supported: false,
    reason: "随机消耗需要补齐与原项目一致的候选池、阈值和确认执行接口语义后再启用。",
    input,
  };
}
