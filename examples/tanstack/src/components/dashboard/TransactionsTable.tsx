import { useEffect, useState } from "react";
import type { FlutterwaveTransaction } from "@alexasomba/better-auth-flutterwave";
import { authClient } from "@/lib/auth-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function TransactionsTable() {
  const [transactions, setTransactions] = useState<FlutterwaveTransaction[]>([]);

  useEffect(() => {
    void authClient.flutterwave.transaction.list().then((result) => {
      setTransactions(result.data?.transactions ?? []);
    });
  }, []);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Flutterwave ID</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((transaction) => (
          <TableRow key={transaction.txRef}>
            <TableCell>{transaction.txRef}</TableCell>
            <TableCell>{transaction.status}</TableCell>
            <TableCell>
              {transaction.currency} {transaction.amount}
            </TableCell>
            <TableCell>{transaction.transactionId ?? "Pending"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
