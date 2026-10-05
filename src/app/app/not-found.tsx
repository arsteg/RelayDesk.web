import { ButtonLink, EmptyState } from "@/components/ui";

export default function NotFound() {
  return <EmptyState title="Not found" description="This record doesn't exist or belongs to another workspace." action={<ButtonLink href="/app">Back to dashboard</ButtonLink>} />;
}
