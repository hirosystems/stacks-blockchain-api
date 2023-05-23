;; (impl-trait 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.nft-trait.nft-trait)
(define-non-fungible-token beeple uint)

;; Public functions
(define-constant nft-not-owned-err (err u401)) ;; unauthorized
(define-constant nft-not-found-err (err u404)) ;; not found
(define-constant sender-equals-recipient-err (err u405)) ;; method not allowed

(define-private (nft-transfer-err (code uint))
  (if (is-eq u1 code)
    nft-not-owned-err
    (if (is-eq u2 code)
      sender-equals-recipient-err
      (if (is-eq u3 code)
        nft-not-found-err
        (err code)))))

;; Transfers tokens to a specified principal.
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (if (and
        (is-eq tx-sender (unwrap! (nft-get-owner? beeple token-id) nft-not-found-err))
        (is-eq tx-sender sender)
        (not (is-eq recipient sender)))
       (match (nft-transfer? beeple token-id sender recipient)
        success (ok success)
        error (nft-transfer-err error))
      nft-not-owned-err))

;; Gets the owner of the specified token ID.
(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? beeple token-id)))

;; Gets the owner of the specified token ID.
(define-read-only (get-last-token-id)
  (ok u1))

(define-read-only (get-token-uri (token-id uint))
  (ok (some "data:application/json,{\"name\":\"Heystack\",\"description\":\"Heystack is a SIP-010-compliant fungible token\",\"imageUrl\":\"https://heystack.xyz/assets/Stacks128w.png\"}")))
  ;; (ok (some "data:text/html,<script>alert('hi');</script>")))
(define-read-only (get-meta (token-id uint))
  (if (is-eq token-id u1)
    (ok (some {name: "EVERYDAYS: THE FIRST 5000 DAYS", uri: "https://ipfsgateway.makersplace.com/ipfs/QmZ15eQX8FPjfrtdX3QYbrhZxJpbLpvDpsgb2p3VEH8Bqq", mime-type: "image/jpeg"}))
    (ok none)))

(define-read-only (get-nft-meta)
  (ok (some {name: "beeple", uri: "https://ipfsgateway.makersplace.com/ipfs/QmZ15eQX8FPjfrtdX3QYbrhZxJpbLpvDpsgb2p3VEH8Bqq", mime-type: "image/jpeg"})))

(define-read-only (get-errstr (code uint))
  (ok (if (is-eq u401 code)
    "nft-not-owned"
    (if (is-eq u404 code)
      "nft-not-found"
      (if (is-eq u405 code)
        "sender-equals-recipient"
        "unknown-error")))))

;; Initialize the contract
(try! (nft-mint? beeple u1 tx-sender))
