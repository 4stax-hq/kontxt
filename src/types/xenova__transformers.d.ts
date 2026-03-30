declare module '@xenova/transformers' {
  export const env: any
  export function pipeline(task: string, model: string, options?: any): Promise<any>
}

