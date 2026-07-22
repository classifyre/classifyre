import { DYNAMIC_ID_SENTINEL } from "@/lib/dynamic-route";

export function generateStaticParams() {
  return [{ namespaceId: DYNAMIC_ID_SENTINEL }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
