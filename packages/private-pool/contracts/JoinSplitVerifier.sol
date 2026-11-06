// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract JoinSplitVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 598311433609439026902884339230366276706401327607861430928103676097345053061;
    uint256 constant alphay  = 15114433817011798252970511459027017916630005529036215046631163342438686380297;
    uint256 constant betax1  = 10284117103255670137590096673701782958010451089528944369774753613139323965226;
    uint256 constant betax2  = 19801121629412697443316284463288728848517345902072511636860194857383420256574;
    uint256 constant betay1  = 8020243262719431655778089276264598453345861173738103801641910404605017646965;
    uint256 constant betay2  = 13874850273897380325601170363926391137491241815667579967071900887450443217622;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 991431167496296909093629697608888693418660360340995378373155491522724547568;
    uint256 constant deltax2 = 15237947682405075567340406916510153662334322892714091977724003651484745640030;
    uint256 constant deltay1 = 13990063471287618679642224436940501491572843316737352950079544215246729717623;
    uint256 constant deltay2 = 16478350290810592169505625311687306045897885009864038642782274997005206709411;

    
    uint256 constant IC0x = 2752329200602036321905382600663897573983580240315543566391533657487733975265;
    uint256 constant IC0y = 11628174777457384804715657029240875374987933990117880067302260994701317916442;
    
    uint256 constant IC1x = 14781686443852390612430051754583053735491960200027350137156796110119283919917;
    uint256 constant IC1y = 9547990117846479122133570220410869645254395715044007853691365170549995959385;
    
    uint256 constant IC2x = 12591204320753654966006892986094290454994004995172627867191165478869329542966;
    uint256 constant IC2y = 7142494610482112443230219047432426795756920498881015364110402027441474921860;
    
    uint256 constant IC3x = 8182724363991121482091934117683428051009592488926033979799187974859032181337;
    uint256 constant IC3y = 2219949795337829813810628850742952456821603533719121515083693821824008006345;
    
    uint256 constant IC4x = 12598137224378616763874425371836942900840336718632157581676249131301183470316;
    uint256 constant IC4y = 4060529888693587499981609504578008110953528797843925824911745945381747789327;
    
    uint256 constant IC5x = 2187776100405439622042599669426767050198352812347551693398625697900010306947;
    uint256 constant IC5y = 11844334995433219590816803529658912145575063264878796874915499170796868454801;
    
    uint256 constant IC6x = 6908746629051795815656558214038023656811137795498882655665593709616726584870;
    uint256 constant IC6y = 3914714279866476612148291847392529095230062375918497670324008167384153707254;
    
    uint256 constant IC7x = 16105915667212493689722857376719674590217686376218964214737900212982559251755;
    uint256 constant IC7y = 20475519633140882934323006295113482717662788931108983648591985560080383710696;
    
    uint256 constant IC8x = 13153392583731813221340515963094382975926066691215843422089752389021940191474;
    uint256 constant IC8y = 19935963695487336386405254601932150833987248405507130364360779098928201954114;
    
    uint256 constant IC9x = 12448276103480922386964596419335475747270847857046608283747793647415311341296;
    uint256 constant IC9y = 7447214023525698134909383923678244511520517929591502510137472527067383987245;
    
    uint256 constant IC10x = 19433252609840285707250078990637734886925376683544659780618816374069613448417;
    uint256 constant IC10y = 20339248452967424183274875373250357584935029572632168916839431042405577705140;
    
    uint256 constant IC11x = 11653428923892736810439182860255831059478172979990344723939945084749073342854;
    uint256 constant IC11y = 13713644584438351654464694791900795464462524806329251902936974912340249848576;
    
    uint256 constant IC12x = 13175697428679948272076032568085633853903746394995974033680407168454152696918;
    uint256 constant IC12y = 9197014143341134325374322851810133255822930744208757865914155719673847136035;
    
    uint256 constant IC13x = 21119274825917816247016364469618826816168685831461428263847622176238851524477;
    uint256 constant IC13y = 15756027016748085725872214561773872931255687411665116404030626528048854579301;
    
    uint256 constant IC14x = 2735653049065010291932279072811905322251039887513298742373816449494980131872;
    uint256 constant IC14y = 15507732719020210334604376180519839739477106459480347202081329220582246974545;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[14] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            
            checkField(calldataload(add(_pubSignals, 416)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
