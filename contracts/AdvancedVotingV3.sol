// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// 2x2 ablation cell "unpacked state + Merkle eligibility" (measurement variant only).
// Identical to AdvancedVoting.sol (baseline) EXCEPT the eligibility mechanism:
// per-voter registerVoter() is replaced by one admin-set Merkle root, and commitVote()
// verifies a sorted-pair Merkle proof (same _verify as AdvancedVotingV2). Storage layout of
// per-voter state is the baseline's (separate flags, commitment, revealedVote), minus the
// now-unused isRegistered flag, which shared a slot with hasCommitted/hasRevealed.
contract AdvancedVotingV3 {
    address public admin;

    enum Phase { Registration, Commit, Reveal, Ended }
    Phase public currentPhase = Phase.Registration;

    struct Candidate {
        uint id;
        string name;
        uint voteCount;
    }

    struct Voter {
        bool hasCommitted;
        bool hasRevealed;
        bytes32 commitment;
        uint revealedVote;
    }

    mapping(address => Voter) public voters;
    mapping(uint => Candidate) public candidates;
    uint public candidateCount;
    bytes32 public merkleRoot;

    uint public commitDeadline;
    uint public revealDeadline;

    event MerkleRootSet(bytes32 root);
    event CandidateAdded(uint id, string name);
    event CommitPhaseStarted(uint commitDeadline);
    event RevealPhaseStarted(uint revealDeadline);
    event VoteCommitted(address voter);
    event VoteRevealed(address voter, uint candidateId);
    event VotingEnded(uint winnerId, string winnerName, uint votes);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    modifier inPhase(Phase p) {
        require(currentPhase == p, "Wrong phase");
        _;
    }

    constructor() {
        admin = msg.sender;
       
    }

    
    function addCandidate(string memory _name) external onlyAdmin inPhase(Phase.Registration) {
        candidateCount++;
        candidates[candidateCount] = Candidate(candidateCount, _name, 0);
        emit CandidateAdded(candidateCount, _name);
    }

    function setMerkleRoot(bytes32 _root) external onlyAdmin inPhase(Phase.Registration) {
        merkleRoot = _root;
        emit MerkleRootSet(_root);
    }

    
    function startCommitPhase(uint _commitSeconds, uint _revealSeconds)
        external
        onlyAdmin
        inPhase(Phase.Registration)
    {
        require(candidateCount > 0, "No candidates");
        require(merkleRoot != bytes32(0), "No eligibility root");
        require(_commitSeconds > 0 && _revealSeconds > 0, "Bad durations");

        currentPhase = Phase.Commit;
        commitDeadline = block.timestamp + _commitSeconds;
        revealDeadline = commitDeadline + _revealSeconds;
        emit CommitPhaseStarted(commitDeadline);
    }

    
    function commitVote(bytes32 _commitment, bytes32[] calldata _proof) external inPhase(Phase.Commit) {
        require(block.timestamp <= commitDeadline, "Commit over");
        Voter storage v = voters[msg.sender];
        require(_verify(_proof, keccak256(abi.encodePacked(msg.sender))), "Not eligible");
        require(!v.hasCommitted, "Already committed");
        v.commitment = _commitment;
        v.hasCommitted = true;
        emit VoteCommitted(msg.sender);
    }

    
    function startRevealPhase() external onlyAdmin {
        require(currentPhase == Phase.Commit, "Not in commit");
        require(block.timestamp > commitDeadline, "Commit still open");
        currentPhase = Phase.Reveal;
        emit RevealPhaseStarted(revealDeadline);
    }

    
    function revealVote(uint _candidateId, string calldata _secret) external inPhase(Phase.Reveal) {
        require(block.timestamp <= revealDeadline, "Reveal over");
        require(_candidateId > 0 && _candidateId <= candidateCount, "Invalid candidate");

        Voter storage v = voters[msg.sender];
        require(v.hasCommitted, "No commit");
        require(!v.hasRevealed, "Already revealed");

        bytes32 checkHash = keccak256(abi.encodePacked(_candidateId, _secret));
        require(checkHash == v.commitment, "Hash mismatch");

        v.hasRevealed = true;
        v.revealedVote = _candidateId;
        candidates[_candidateId].voteCount += 1;
        emit VoteRevealed(msg.sender, _candidateId);
    }

    
    function endVoting() external onlyAdmin {
        require(currentPhase == Phase.Reveal, "Not in reveal");
        require(block.timestamp > revealDeadline, "Reveal still open");
        currentPhase = Phase.Ended;

        (uint winnerId,,) = _tallyWinner();
        emit VotingEnded(winnerId, candidates[winnerId].name, candidates[winnerId].voteCount);
    }

   
    function getCandidate(uint id) external view returns (string memory name, uint votes) {
        Candidate storage c = candidates[id];
        return (c.name, c.voteCount);
    }

    function getWinner() external view returns (uint id, string memory name, uint votes) {
        require(currentPhase == Phase.Ended, "Not ended");
        (uint winnerId, string memory winnerName, uint vCount) = _tallyWinner();
        return (winnerId, winnerName, vCount);
    }

    
    function _tallyWinner() internal view returns (uint id, string memory name, uint votes) {
        uint winnerId = 0;
        uint top = 0;
        for (uint i = 1; i <= candidateCount; i++) {
            uint cVotes = candidates[i].voteCount;
            if (cVotes > top) {
                top = cVotes;
                winnerId = i;
            }
        }
        return (winnerId, candidates[winnerId].name, top);
    }

    function _verify(bytes32[] calldata proof, bytes32 leaf) internal view returns (bool) {
        bytes32 computed = leaf;
        for (uint i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            computed = computed < p
                ? keccak256(abi.encodePacked(computed, p))
                : keccak256(abi.encodePacked(p, computed));
        }
        return computed == merkleRoot;
    }
}
