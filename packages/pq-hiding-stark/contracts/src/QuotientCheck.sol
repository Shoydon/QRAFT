// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Goldilocks5 as G} from "./Goldilocks5.sol";
/// @notice Fixed Plonky3 quotient recomposition and original-trace selectors.
/// @dev N=2048; sixteen N-point chunks of the shift-seven 32768-point domain.
/// An AIR accumulator check only; this component does not verify a full proof.
library QuotientCheck {
    uint256 internal constant N=2048;
    uint256 internal constant P=18446744069414584321;
    error TraceDomainPoint();
    error QuotientMismatch();
    struct Selectors {uint256[5] first;uint256[5] last;uint256[5] transition;uint256[5] invVanishing;}
    function selectors(uint256[5] memory zeta)internal pure returns(Selectors memory s){
        G.check(zeta);uint256[5] memory zh=G.sub(G.pow(zeta,N),G.one());
        if(zh[0]|zh[1]|zh[2]|zh[3]|zh[4]==0)revert TraceDomainPoint();
        uint256 lastPoint=G.inverseBase(G.powBase(7,(P-1)/N));
        s.transition=G.sub(zeta,G.fromBase(lastPoint));
        s.first=G.div(zh,G.sub(zeta,G.one()));s.last=G.div(zh,s.transition);s.invVanishing=G.inverse(zh);
    }
    function recompose(uint256[5] memory zeta,uint256[5][5][16] memory chunks)internal pure returns(uint256[5] memory q){
        G.check(zeta);uint256[5] memory u=G.pow(zeta,N);
        uint256[16] memory si;uint256[5][16] memory factors;uint256[5][16] memory before;
        uint256[5] memory prefix=G.one();uint256 shift=7;uint256 generator=G.powBase(7,(P-1)/32768);
        for(uint256 i;i<16;++i){si[i]=G.powBase(shift,N);factors[i]=G.sub(u,G.fromBase(si[i]));before[i]=prefix;prefix=G.mul(prefix,factors[i]);shift=G.mulBase(shift,generator);}
        uint256[5] memory suffix=G.one();
        // Leave-one-out products also work where one chunk vanishes. Never divide
        // a total product by that chunk's vanishing polynomial.
        for(uint256 cursor=16;cursor!=0;){uint256 i=--cursor;uint256 denominator=1;
            for(uint256 j;j<16;++j)if(j!=i)denominator=G.mulBase(denominator,G.subBase(si[i],si[j]));
            uint256[5] memory weight=G.scale(G.mul(before[i],suffix),G.inverseBase(denominator));uint256[5] memory chunk;
            for(uint256 k;k<5;++k){uint256[5] memory basis;basis[k]=1;chunk=G.add(chunk,G.mul(chunks[i][k],basis));}
            q=G.add(q,G.mul(weight,chunk));suffix=G.mul(suffix,factors[i]);
        }
    }
    function checkIdentity(uint256[5] memory zeta,uint256[5][5][16] memory chunks,uint256[5] memory accumulator)internal pure{
        G.check(accumulator);Selectors memory s=selectors(zeta);
        uint256[5] memory actual=G.mul(accumulator,s.invVanishing);uint256[5] memory expected=recompose(zeta,chunks);
        for(uint256 i;i<5;++i)if(actual[i]!=expected[i])revert QuotientMismatch();
    }
}
