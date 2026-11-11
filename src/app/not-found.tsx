import Link from "next/link";

export default function NotFound() {
  return (
    <div className="pt-10">
      <h1 className="text-4xl font-bold">Page not found</h1>
      <p className="mt-3 max-w-[60ch] text-muted">
        That page or product does not exist on SmartBuy. Search for a product from the box above, or{" "}
        <Link href="/">go to the home page</Link>.
      </p>
    </div>
  );
}
