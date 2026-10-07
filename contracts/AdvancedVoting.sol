// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract AdvancedVoting {
    address public admin;

    enum Phase { Registration, Commit, Reveal, Ended }
    Phase public currentPhase = Phase.Registration;

    struct Candidate {
        uint id;
        string name;
        uint voteCount;
    }

    struct Voter {
        bool isRegistered;
        bool hasCommitted;
        bool hasRevealed;
        bytes32 commitment;
        uint revealedVote;
    }

    mapping(address => Voter) public voters;
    mapping(uint => Candidate) public candidates;
    uint public candidateCount;

    uint public commitDeadline;
    uint public revealDeadline;

    event VoterRegistered(address voter);
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

    function registerVoter(address _voter) external onlyAdmin inPhase(Phase.Registration) {
        require(!voters[_voter].isRegistered, "Already registered");
        voters[_voter].isRegistered = true;
        emit VoterRegistered(_voter);
    }

    
    function startCommitPhase(uint _commitSeconds, uint _revealSeconds)
        external
        onlyAdmin
        inPhase(Phase.Registration)
    {
        require(candidateCount > 0, "No candidates");
        require(_commitSeconds > 0 && _revealSeconds > 0, "Bad durations");

        currentPhase = Phase.Commit;
        commitDeadline = block.timestamp + _commitSeconds;
        revealDeadline = commitDeadline + _revealSeconds;
        emit CommitPhaseStarted(commitDeadline);
    }

    
    function commitVote(bytes32 _commitment) external inPhase(Phase.Commit) {
        require(block.timestamp <= commitDeadline, "Commit over");
        Voter storage v = voters[msg.sender];
        require(v.isRegistered, "Not registered");
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
        require(v.isRegistered, "Not registered");
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
}
