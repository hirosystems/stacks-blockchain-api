;; https://github.com/hirosystems/stacks-subnets/blob/master/core-contracts/contracts/helper/simple-nft.clar

(define-constant CONTRACT_OWNER tx-sender)
(define-constant CONTRACT_ADDRESS (as-contract tx-sender))

(define-constant ERR_NOT_AUTHORIZED (err u1001))

(impl-trait 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.sip-traits.nft-trait)
(impl-trait 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.subnet-traits.mint-from-subnet-trait)

(define-data-var lastId uint u0)
(define-map CFG_BASE_URI bool (string-ascii 256))

(define-non-fungible-token nft-token uint)

(define-read-only (get-last-token-id)
  (ok (var-get lastId))
)

(define-read-only (get-owner (id uint))
  (ok (nft-get-owner? nft-token id))
)

(define-read-only (get-token-uri (id uint))
  (ok (map-get? CFG_BASE_URI true))
)

(define-public (transfer (id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_AUTHORIZED)
    (nft-transfer? nft-token id sender recipient)
  )
)

;; test functions
(define-public (test-mint (recipient principal))
  (let
    ((newId (+ (var-get lastId) u1)))
    (var-set lastId newId)
    (nft-mint? nft-token newId recipient)
  )
)

(define-public (mint-from-subnet (id uint) (sender principal) (recipient principal))
    (begin
        ;; Check that the tx-sender is the provided sender
        (asserts! (is-eq tx-sender sender) ERR_NOT_AUTHORIZED)

        (nft-mint? nft-token id recipient)
    )
)

(define-public (gift-nft (recipient principal) (id uint))
  (begin
    (nft-mint? nft-token id recipient)
  )
)
