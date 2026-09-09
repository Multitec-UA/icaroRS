"use client";

/**
 * Mounts the app's single TanStack Query client (see lib/query-client.ts).
 * Lives at the root of the provider stack (app/layout.tsx) so every route can
 * use useQuery/useMutation regardless of auth status.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { getQueryClient } from "@/lib/query-client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
