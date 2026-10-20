export interface ValidationError {
  field: string;
  message: string;
}

export interface BrainChatMessage {
  role: string;
  content: string;
}

export interface BrainChatV1Payload {
  email: string;
  consent: boolean;
  messages: BrainChatMessage[];
  tags?: string[];
  password?: string;
}

export interface ValidationOptions {
  /** When true, `password` is required and must be at least 8 characters. */
  registration?: boolean;
}

export type ValidationResult =
  | { ok: true; value: BrainChatV1Payload }
  | { ok: false; errors: ValidationError[] };

/** Maximum decoded size of a single message content (100 KiB = 100 × 1024 bytes). */
export const MAX_MESSAGE_BYTES = 100 * 1024;

/** Maximum combined decoded size of all message contents (10 MiB = 10 × 1024 × 1024 bytes). */
export const MAX_CHAT_BYTES = 10 * 1024 * 1024;

/**
 * Maximum total serialized HTTP request body size for a chat import
 * (12 MiB = 12 × 1024 × 1024 bytes).
 *
 * This is an independent restriction on the *serialized JSON* body. JSON
 * structure and escaping (e.g. `\\n`, `\\"`, `\\\\`) can make the serialized
 * body larger than the decoded message content, so a payload whose decoded
 * content is within {@link MAX_CHAT_BYTES} can still exceed this limit and be
 * rejected with HTTP 413.
 */
export const MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024;

/** Maximum length of a single tag, in characters. */
export const MAX_TAG_LENGTH = 64;

/** Minimum password length for registration. */
export const MIN_PASSWORD_LENGTH = 8;

/** Maximum password size in bytes. bcrypt truncates input beyond 72 bytes. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Message roles supported by the `brain.chat.v1` import contract:
 * `user`, `assistant` and `system`.
 *
 * No import adapter, fixture or documented source format currently requires
 * additional roles, so the contract is restricted to these three. Unsupported
 * roles are rejected with a field error rather than silently remapped.
 */
export const ALLOWED_ROLES: readonly string[] = ['user', 'assistant', 'system'];

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns `true` when `value` is a non-empty string matching the email format. */
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && EMAIL_REGEX.test(value);
}

/**
 * Returns an error message when `value` violates the password policy, or
 * `null` when it is acceptable. The policy requires a non-empty string of at
 * least {@link MIN_PASSWORD_LENGTH} characters and at most
 * {@link MAX_PASSWORD_BYTES} bytes (bcrypt truncates input beyond that).
 */
export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') {
    return 'password ist erforderlich';
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `password muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`;
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    return `password darf maximal ${MAX_PASSWORD_BYTES} Bytes lang sein`;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Validate a `brain.chat.v1` payload.
 *
 * Enforces required fields (`email`, `consent`, `messages` with `role` and
 * `content`), an email format, a `consent` of `true`, per-message (100 KB) and
 * whole-chat (10 MB) size limits, optional tags (each at most 64 characters)
 * and — only for registration — a password of at least 8 characters.
 */
export function validateBrainChatV1(
  payload: unknown,
  options: ValidationOptions = {},
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isObject(payload)) {
    return {
      ok: false,
      errors: [{ field: 'payload', message: 'payload muss ein Objekt sein' }],
    };
  }

  // email
  if (typeof payload.email !== 'string' || payload.email.trim() === '') {
    errors.push({ field: 'email', message: 'email ist erforderlich' });
  } else if (!EMAIL_REGEX.test(payload.email)) {
    errors.push({ field: 'email', message: 'email ist keine gültige E-Mail-Adresse' });
  }

  // consent (must be explicitly true)
  if (typeof payload.consent !== 'boolean') {
    errors.push({ field: 'consent', message: 'consent ist erforderlich' });
  } else if (payload.consent !== true) {
    errors.push({ field: 'consent', message: 'consent muss true sein' });
  }

  // messages
  if (!Array.isArray(payload.messages)) {
    errors.push({
      field: 'messages',
      message: 'messages ist erforderlich und muss ein Array sein',
    });
  } else if (payload.messages.length === 0) {
    errors.push({ field: 'messages', message: 'messages darf nicht leer sein' });
  } else {
    let chatBytes = 0;
    for (let i = 0; i < payload.messages.length; i++) {
      const message = payload.messages[i];
      if (!isObject(message)) {
        errors.push({ field: `messages[${i}]`, message: 'Nachricht muss ein Objekt sein' });
        continue;
      }

      if (typeof message.role !== 'string' || message.role.trim() === '') {
        errors.push({ field: `messages[${i}].role`, message: 'role ist erforderlich' });
      } else if (!ALLOWED_ROLES.includes(message.role)) {
        errors.push({
          field: `messages[${i}].role`,
          message: `role muss eines von ${ALLOWED_ROLES.join(', ')} sein`,
        });
      }

      if (typeof message.content !== 'string') {
        errors.push({ field: `messages[${i}].content`, message: 'content ist erforderlich' });
      } else if (message.content.trim() === '') {
        errors.push({ field: `messages[${i}].content`, message: 'content darf nicht leer sein' });
      } else {
        const size = byteLength(message.content);
        chatBytes += size;
        if (size > MAX_MESSAGE_BYTES) {
          errors.push({
            field: `messages[${i}].content`,
            message: 'content darf 100 KB nicht überschreiten',
          });
        }
      }
    }

    if (chatBytes > MAX_CHAT_BYTES) {
      errors.push({
        field: 'messages',
        message: 'Der Chat darf 10 MB nicht überschreiten',
      });
    }
  }

  // tags (optional)
  if (payload.tags !== undefined) {
    if (!Array.isArray(payload.tags)) {
      errors.push({ field: 'tags', message: 'tags muss ein Array sein' });
    } else {
      for (let i = 0; i < payload.tags.length; i++) {
        const tag = payload.tags[i];
        if (typeof tag !== 'string') {
          errors.push({ field: `tags[${i}]`, message: 'Tag muss ein String sein' });
        } else if (tag.length > MAX_TAG_LENGTH) {
          errors.push({
            field: `tags[${i}]`,
            message: 'Tag darf maximal 64 Zeichen lang sein',
          });
        }
      }
    }
  }

  // password (registration only)
  if (options.registration) {
    const passwordError = validatePassword(payload.password);
    if (passwordError) {
      errors.push({ field: 'password', message: passwordError });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: payload as unknown as BrainChatV1Payload };
}
