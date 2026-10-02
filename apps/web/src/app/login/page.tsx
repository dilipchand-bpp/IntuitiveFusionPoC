import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in – Intuitive Fusion' };

// TODO(M5): branded login screen (logo, forgot-password flow, polished layout). This version is functional but plain.
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-bold">Sign in</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
