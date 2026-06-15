/**
 * Abstração de envio de email. O provedor real (ex.: Resend) entra numa issue
 * futura só implementando esta interface — sem retrabalho no fluxo de auth.
 *
 * Design: o Better Auth chama `emailSender.sendPasswordReset(...)` por trás de
 * `sendResetPassword`. Trocar de provedor = trocar a implementação injetada,
 * nada mais. No MVP, logamos o link no console (dev).
 */
export interface EmailSender {
  sendPasswordReset(to: string, resetUrl: string): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  /** Registro em memória dos emails "enviados" — usado por dev/testes. */
  readonly outbox: { to: string; resetUrl: string }[] = [];

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    this.outbox.push({ to, resetUrl });
    console.log(
      `\n[email:dev] Reset de senha para ${to}\n[email:dev] Link: ${resetUrl}\n`,
    );
  }
}

/** Instância usada pela app. Substituível por um provedor real na issue futura. */
export const emailSender = new ConsoleEmailSender();
