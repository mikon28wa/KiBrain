export type ViewState = 'empty' | 'filled' | 'loading' | 'error';

/** Auth endpoints used by the views. Injectable for tests. */
export interface AuthApi {
  register(email: string, password: string): Promise<unknown>;
  login(email: string, password: string): Promise<unknown>;
  requestPasswordReset(email: string): Promise<unknown>;
  resetPassword(token: string, password: string): Promise<unknown>;
}
