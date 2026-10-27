import { VoucherEditor } from "@/components/voucher-editor";

export const metadata = { title: "Voucher · Cheque Desk" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoucherEditor id={id} />;
}
