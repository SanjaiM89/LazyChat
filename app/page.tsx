import { App } from "@/components/App";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const initialView =
    view === "brain" ? "brain" : view === "workspace" ? "workspace" : view === "chat" ? "chat" : undefined;
  return <App initialView={initialView} />;
}
