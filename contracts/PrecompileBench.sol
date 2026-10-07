// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PrecompileBench
/// @notice Benchmarks the gas cost of the *dominant* on-chain cryptographic
/// operations used by ZKP-, ring-signature-, and mixnet-based voting
/// verification, using Ethereum's real BN254 (alt_bn128) precompiles
/// (ecAdd = 0x06, ecMul = 0x07, ecPairing = 0x08; gas-priced per
/// EIP-196/197/1108). This does not re-implement any single published
/// scheme end-to-end; it measures the structural EC-operation pattern that
/// each family of schemes is known to require for on-chain verification,
/// so the resulting gas figures are directly measured rather than assumed
/// or taken from a secondary source.
contract PrecompileBench {
    // BN254 G1 generator
    uint256 constant G1X = 1;
    uint256 constant G1Y = 2;

    // BN254 G2 generator (EIP-197)
    uint256 constant G2X0 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant G2X1 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant G2Y0 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant G2Y1 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;

    uint256 constant FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    mapping(uint256 => bytes32) public store;

    // ---------- Low-level precompile wrappers ----------

    function _ecAdd(uint256 x1, uint256 y1, uint256 x2, uint256 y2) internal view returns (uint256 rx, uint256 ry) {
        uint256[4] memory input = [x1, y1, x2, y2];
        uint256[2] memory output;
        bool ok;
        assembly {
            ok := staticcall(gas(), 0x06, input, 0x80, output, 0x40)
        }
        require(ok, "ecAdd failed");
        return (output[0], output[1]);
    }

    function _ecMul(uint256 x1, uint256 y1, uint256 scalar) internal view returns (uint256 rx, uint256 ry) {
        uint256[3] memory input = [x1, y1, scalar];
        uint256[2] memory output;
        bool ok;
        assembly {
            ok := staticcall(gas(), 0x07, input, 0x60, output, 0x40)
        }
        require(ok, "ecMul failed");
        return (output[0], output[1]);
    }

    /// @dev Performs a k-pair BN254 pairing check using the generator points
    /// (validity of the pairing result is irrelevant for gas measurement;
    /// only that the points are valid curve elements so the precompile does
    /// not revert).
    function _ecPairing(uint256 k) internal view returns (bool result) {
        uint256[] memory input = new uint256[](k * 6);
        for (uint256 i = 0; i < k; i++) {
            input[i * 6 + 0] = G1X;
            input[i * 6 + 1] = G1Y;
            input[i * 6 + 2] = G2X0;
            input[i * 6 + 3] = G2X1;
            input[i * 6 + 4] = G2Y0;
            input[i * 6 + 5] = G2Y1;
        }
        uint256[1] memory output;
        bool ok;
        uint256 len = input.length * 32;
        assembly {
            ok := staticcall(gas(), 0x08, add(input, 0x20), len, output, 0x20)
        }
        require(ok, "pairing failed");
        return output[0] == 1;
    }

    // ---------- Ring signature verification (Schnorr/AOS-style loop) ----------
    // Standard EC-based ring signature verification (e.g. AOS-style, as used
    // in linkable ring signature schemes) reconstructs a hash-chain around
    // the ring: for each member i, R_i = s_i*G + c_i*P_i (two scalar mults,
    // one addition), then c_{i+1} = H(msg, R_i) (one hash). This loop
    // reproduces exactly that operation count per ring member.
    function ringVerify(uint256 n) external returns (bytes32) {
        uint256 cx = G1X;
        uint256 cy = G1Y;
        bytes32 c = keccak256(abi.encodePacked("init"));
        for (uint256 i = 0; i < n; i++) {
            uint256 s = (uint256(c) % (FIELD_ORDER - 1)) + 1;
            (uint256 ax, uint256 ay) = _ecMul(G1X, G1Y, s);
            (uint256 bx, uint256 by) = _ecMul(cx, cy, i + 1);
            (uint256 rx, uint256 ry) = _ecAdd(ax, ay, bx, by);
            c = keccak256(abi.encodePacked(rx, ry, i));
            cx = rx;
            cy = ry;
        }
        store[n] = c;
        return c;
    }

    // ---------- Groth16-style ZKP verification ----------
    // vk_x = sum_i (input_i * L_i) via `l` scalar mults + additions, followed
    // by the standard single 4-pair Groth16 pairing check
    // e(A,B)*e(alpha,beta)^-1*e(vk_x,gamma)^-1*e(C,delta)^-1 = 1.
    function zkpVerify(uint256 numPublicInputs) external returns (bool) {
        uint256 vx = G1X;
        uint256 vy = G1Y;
        for (uint256 i = 0; i < numPublicInputs; i++) {
            (uint256 ax, uint256 ay) = _ecMul(G1X, G1Y, i + 1);
            (vx, vy) = _ecAdd(vx, vy, ax, ay);
        }
        return _ecPairing(4);
    }

    // ---------- Mixnet round: re-encryption + storage + shuffle proof ----------
    // Per ciphertext: one EC-ElGamal re-encryption (ecMul + ecAdd) and one
    // cold SSTORE of the resulting ciphertext hash on-chain. Once per round:
    // a single 4-pair pairing check standing in for a succinct
    // shuffle-correctness argument (constant-size verification regardless
    // of batch size, matching the succinctness property of pairing-based
    // shuffle proofs).
    function mixnetRound(uint256 nCiphertexts) external returns (bytes32) {
        bytes32 last;
        for (uint256 i = 0; i < nCiphertexts; i++) {
            (uint256 rx, uint256 ry) = _ecMul(G1X, G1Y, i + 1);
            (uint256 ax, uint256 ay) = _ecAdd(rx, ry, G1X, G1Y);
            bytes32 h = keccak256(abi.encodePacked(ax, ay, i));
            store[i] = h;
            last = h;
        }
        _ecPairing(4);
        return last;
    }
}
