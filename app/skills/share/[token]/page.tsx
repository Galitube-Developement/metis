import Link from "next/link";
import { SharedSkillImport } from "@/components/shared-skill-import";
export const metadata = { title: "Shared skill · Metis", robots: { index:false, follow:false } };
export default async function SharedSkillPage({ params }: { params: Promise<{token:string}> }) {
  const {token}=await params;
  return <main className="mx-auto min-h-dvh w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5"><Link href="/" className="text-lg font-semibold">Metis</Link><span className="text-sm text-muted-foreground">Shared skill</span></header>
    <SharedSkillImport initialToken={token} />
  </main>;
}
