"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AuthLayout } from "@/components/ui/auth-layout";
import { FormField, inputClassName, buttonPrimaryClassName } from "@/components/ui/page-header";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Registration failed. Check your details and try again.");
        return;
      }
      window.location.href = "/profile";
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up your student profile to start verified job and internship discovery."
      footer={
        <>
          Already registered?{" "}
          <Link href="/login" className="font-medium text-brand-text hover:underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="Full name">
          <input
            className={inputClassName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            placeholder="Your legal name"
          />
        </FormField>

        <FormField label="Email address">
          <input
            type="email"
            className={inputClassName}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            placeholder="you@university.edu"
          />
        </FormField>

        <FormField
          label="Password"
          hint="Minimum 8 characters with uppercase, lowercase, number, and symbol."
        >
          <input
            type="password"
            className={inputClassName}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </FormField>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <button type="submit" disabled={loading} className={`${buttonPrimaryClassName} w-full`}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}
