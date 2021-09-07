;; Implement the `ft-trait` trait defined in the `ft-trait` contract
;; https://github.com/hstove/stacks-fungible-token
(impl-trait 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.ft-trait.sip-010-trait)

(define-constant contract-creator tx-sender)

(define-fungible-token hey-token)

;; Mint developer tokens
(ft-mint? hey-token u10000 contract-creator)
(ft-mint? hey-token u10000 'ST399W7Z9WS0GMSNQGJGME5JADNKN56R65VGM5KGA) ;; fara
(ft-mint? hey-token u10000 'ST1X6M947Z7E58CNE0H8YJVJTVKS9VW0PHEG3NHN3) ;; thomas
(ft-mint? hey-token u10000 'ST1NY8TXACV7D74886MK05SYW2XA72XJMDVPF3F3D) ;; kyran
(ft-mint? hey-token u10000 'ST34XEPDJJFJKFPT87CCZQCPGXR4PJ8ERFRP0F3GX) ;; jasper
(ft-mint? hey-token u10000 'ST3AGWHGAZKQS4JQ67WQZW5X8HZYZ4ZBWPPNWNMKF) ;; andres
(ft-mint? hey-token u10000 'ST17YZQB1228EK9MPHQXA8GC4G3HVWZ66X779FEBY) ;; esh
(ft-mint? hey-token u10000 'ST3Q0M9WAVBW633CG72VHNFZM2H82D2BJMBX85WP4) ;; mark

;; get the token balance of owner
(define-read-only (get-balance (owner principal))
  (begin
    (ok (ft-get-balance hey-token owner))))

;; returns the total number of tokens
(define-read-only (get-total-supply)
  (ok (ft-get-supply hey-token)))

;; returns the token name
(define-read-only (get-name)
  (ok "Heystack Token"))

;; the symbol or "ticker" for this token
(define-read-only (get-symbol)
  (ok "HEY"))

;; the number of decimals used
(define-read-only (get-decimals)
  (ok u0))

;; Transfers tokens to a recipient
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (if (is-eq tx-sender sender)
    (begin
      (try! (ft-transfer? hey-token amount sender recipient))
      (print memo)
      (ok true)
    )
    (err u4)))

(define-read-only (get-token-uri)
  (ok (some u"https://heystack.xyz/token-metadata.json")))

(define-public (gift-tokens (recipient principal))
  (begin
    (asserts! (is-eq tx-sender recipient) (err u0))
    (ft-mint? hey-token u1 recipient)
  )
)
