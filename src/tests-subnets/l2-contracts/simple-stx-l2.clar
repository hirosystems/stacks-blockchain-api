(define-public (subnet-withdraw-stx (amount uint) (sender principal))
  (contract-call? 'ST000000000000000000002AMW42H.subnet stx-withdraw? amount sender)
)
