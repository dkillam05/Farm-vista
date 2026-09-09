from pathlib import Path

p = Path('pages/grain/grain-ticket-detail.html')
s = p.read_text()

old = '''    function soldUnderOcrEvidence(
      ticket
    ) {

      return {
        account:
          normalizedSoldUnderOcr(
            ticket?.ocrCustomerAccountText ||
            ticket?.customerAccountText ||
            ""
          ),

        name:
          normalizedSoldUnderOcr(
            ticket?.ocrCustomerText ||
            ticket?.customerText ||
            ""
          )
      };

    }'''

new = '''    function soldUnderOcrEvidence(
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

count = s.count(old)
if count < 1:
    raise SystemExit('soldUnderOcrEvidence block not found')

p.write_text(s.replace(old, new))
print(f'Updated {count} soldUnderOcrEvidence block(s)')
