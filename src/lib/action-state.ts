export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Submitted values echoed back so forms keep user input after an error. */
  values?: Record<string, string>;
}

export const initialActionState: ActionState = {};
