import { redirect } from "next/navigation";

/**
 * The standalone /brain route is retired: the Company Brain now lives inside
 * the single Omnia shell. Old bookmarks land on the brain view.
 */
export default function BrainPage() {
  redirect("/?view=brain");
}
