from pathlib import Path

p = Path('pages/grain/grain-ticket-detail.html')
s = p.read_text()

old = '''    function soldUnderOcrEvidence(
      ticket
    ) {

      const hasResolvedCustomer =
        Boolean(
          clean(
            ticket?.grainCustomerId ||
            ticket?.customerId
          )
        );

      return {
        account:
          normalizedSoldUnderOcr(
            ticket?.ocrCustomerAccountText ||
            ticket?.customerAccountText ||
            ticket?.customerAccount ||
            ticket?.customerCode ||
            ticket?.customerNumber ||
            ""
          ),

        name:
          normalizedSoldUnderOcr(
            ticket?.ocrCustomerText ||
            ticket?.customerText ||
            ticket?.scannedCustomerText ||
            ticket?.rawCustomerName ||
            (!hasResolvedCustomer
              ? (
                  ticket?.customerName ||
                  ticket?.customer ||
                  ticket?.soldUnder ||
                  ""
                )
              : "")
          )
      };

    }'''

new = '''    function soldUnderOcrEvidence(
      ticket
    ) {

      const storedCustomerId =
        clean(
          ticket?.grainCustomerId ||
          ticket?.customerId
        );

      const hasResolvedCustomer =
        Boolean(
          storedCustomerId &&
          state.customers.some(
            customer =>
              clean(customer?.id) ===
              storedCustomerId
          )
        );

      const unresolvedStoredCustomer =
        !hasResolvedCustomer
          ? (
              ticket?.customerAccount ||
              ticket?.customerCode ||
              ticket?.customerNumber ||
              storedCustomerId ||
              ticket?.customerName ||
              ticket?.customer ||
              ticket?.soldUnder ||
              ""
            )
          : "";

      return {
        account:
          normalizedSoldUnderOcr(
            ticket?.ocrCustomerAccountText ||
            ticket?.customerAccountText ||
            ticket?.customerAccount ||
            ticket?.customerCode ||
            ticket?.customerNumber ||
            (!hasResolvedCustomer ? storedCustomerId : "") ||
            ""
          ),

        name:
          normalizedSoldUnderOcr(
            ticket?.ocrCustomerText ||
            ticket?.customerText ||
            ticket?.scannedCustomerText ||
            ticket?.rawCustomerName ||
            unresolvedStoredCustomer ||
            ""
          )
      };

    }'''

if old not in s:
    raise SystemExit('soldUnderOcrEvidence block not found')
s = s.replace(old, new, 1)

old = '''      const matches =
        state.tickets.filter(
          ticket =>
            ticket?.id !==
              ticketId &&
            normalize(
              ticket?.validationStatus
            ) ===
              "needs_review" &&
            clean(
              ticket?.customerId
            ) !==
              clean(
                selectedCustomer.id
              ) &&
            sameSoldUnderOcrEvidence(
              state.ticket,
              ticket
            )
        );'''

new = '''      const matches =
        state.tickets.filter(
          ticket => {
            if (
              ticket?.id ===
                ticketId
            ) {
              return false;
            }

            const candidateCustomerId =
              clean(
                ticket?.grainCustomerId ||
                ticket?.customerId
              );

            if (
              candidateCustomerId ===
                clean(selectedCustomer.id)
            ) {
              return false;
            }

            const candidateStatus =
              normalize(
                ticket?.validationStatus ||
                ticket?.status ||
                ""
              );

            const candidateReasons =
              Array.isArray(ticket?.reviewReasons)
                ? ticket.reviewReasons
                : [];

            const stillNeedsReview =
              candidateStatus === "needs_review" ||
              candidateStatus === "review" ||
              candidateStatus === "needs review" ||
              candidateReasons.length > 0;

            return (
              stillNeedsReview &&
              sameSoldUnderOcrEvidence(
                state.ticket,
                ticket
              )
            );
          }
        );'''

if old not in s:
    raise SystemExit('bulk matches block not found')
s = s.replace(old, new, 1)
p.write_text(s)

v = Path('js/version.js')
t = v.read_text()
if 'number:  "09.09.01"' not in t:
    raise SystemExit('Expected version 09.09.01 not found')
t = t.replace('number:  "09.09.01"', 'number:  "09.09.02"', 1)
t = t.replace('date:    "2026-09-08"', 'date:    "2026-09-09"', 1)
v.write_text(t)
