import Link from 'next/link';
import { Logo, PageHeader } from '@if/ui';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Reset your password – Intuitive Fusion' };

export default function ForgotPasswordPage() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="w-fit text-text no-underline" aria-label="Intuitive Fusion home">
        <Logo withName size={40} />
      </Link>
      <PageHeader
        title="Reset your password"
        subtitle="Enter your work email and we will send reset instructions if an account exists."
      />
      <ForgotForm />
      <Link href="/login">Back to sign in</Link>
    </main>
  );
}
