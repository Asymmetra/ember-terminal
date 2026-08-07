"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AccountsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/profile");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ember-black">
      <span className="font-mono text-[10px] text-text-secondary/40 animate-pulse">
        Redirecting...
      </span>
    </div>
  );
}
