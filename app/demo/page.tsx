import ListeningExperience from "../../components/listening-experience";
import { loadDemoPlaylist } from "../../server/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Demo · 声签" };

export default function Demo() {
  return <ListeningExperience initialPlaylist={loadDemoPlaylist()} />;
}
