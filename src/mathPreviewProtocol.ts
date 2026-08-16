export type MathJaxMacroOption =
  | string
  | readonly [string, number]
  | readonly [string, number, string];

export interface MathPreviewWorkerRequest {
  readonly type: "render";
  readonly id: number;
  readonly tex: string;
  readonly display: boolean;
  readonly macros: Readonly<Record<string, MathJaxMacroOption>>;
  readonly macroFingerprint: string;
  readonly foreground: string;
  readonly scale: number;
}

export interface MathPreviewWorkerSuccess {
  readonly type: "result";
  readonly id: number;
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
}

export interface MathPreviewWorkerFailure {
  readonly type: "error";
  readonly id: number;
  readonly message: string;
}

export type MathPreviewWorkerResponse =
  | MathPreviewWorkerSuccess
  | MathPreviewWorkerFailure;
