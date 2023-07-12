;; https://github.com/hirosystems/stacks-subnets/blob/master/core-contracts/contracts/helper/subnet-traits.clar

;; In order to process deposits and withdrawals to a subnet, an asset
;; contract must implement this trait.
(define-trait mint-from-subnet-trait
  (
    ;; Process a withdrawal from the subnet for an asset which does not yet
    ;; exist on this network, and thus requires a mint.
    (mint-from-subnet
      (
        uint       ;; asset-id (NFT) or amount (FT)
        principal  ;; sender
        principal  ;; recipient
      )
      (response bool uint)
    )
  )
)
