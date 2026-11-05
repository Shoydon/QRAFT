// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Blake2b_512 as H} from "./Blake2b_512.sol";
import {BlakeMerkle as M} from "./BlakeMerkle.sol";
import {WithdrawalProofCodec as C} from "./WithdrawalProofCodec.sol";
import {DeepCheck as D} from "./DeepCheck.sol";
import {FriFold as F} from "./FriFold.sol";
import {QuotientCheck as Q} from "./QuotientCheck.sol";

/// @dev Stateless fixed arithmetic/codec implementation, runtime-pinned by the session.
contract WithdrawalSessionArithmetic {
 error Shape();
 function shape(C.Claims memory c,uint256[5] memory last)external pure{C.shape(c);C.extensionLE(last);}
 function record(uint256 move,C.Claims memory c,M.Digest[3] memory roots,M.Digest[12] memory fri,uint256[5] memory last,bytes memory root,bytes memory nul,bytes memory context)external pure returns(bytes memory){
  if(move==0)return C.starkMessage(_bytes(roots[0]),root,nul,context);
  if(move==1)return C.rootsMessage(_bytes(roots[1]),_bytes(roots[2]));
  if(move==2)return C.pcsMessage(c);
  if(move<15)return C.friMessage(move-3,_bytes(fri[move-3]));
  if(move==15)return C.extensionLE(last);revert Shape();
 }
 function preprocessingRoot()external pure returns(M.Digest memory d){bytes memory b=C.PREPROCESSING_ROOT;assembly("memory-safe"){mstore(d,mload(add(b,32)))mstore(add(d,32),mload(add(b,64)))}}
 function airWindow(C.Claims memory c,bytes memory root,bytes memory nul,bytes memory context,uint256[5] memory zeta)external pure returns(bytes memory){return C.airWindow(c,root,nul,context,zeta);}
 function quotient(C.Claims memory c,uint256[5] memory zeta,uint256[5] memory accumulator)external pure{
  C.shape(c);uint256[5][5][16] memory chunks;for(uint256 i;i<16;++i)for(uint256 k;k<5;++k)for(uint256 j;j<5;++j)chunks[i][k][j]=_u64(c.quotient,(i*25+k*5+j)*8);Q.checkIdentity(zeta,chunks,accumulator);
 }
 function claimChunk(C.Claims memory c,uint256 point,uint256 end,uint256[5] memory gamma,uint256[5] memory high)external pure returns(uint256[5] memory){
  bytes memory row=C.point(c,point);if(end==0||end>D.pointWidth(point))revert Shape();uint256 n=end>256?256:end;return D.appendLower(high,D.projectExtension(C.slice(row,(end-n)*40,n*40),gamma),n,gamma);
 }
 function rowChunk(bytes memory row,uint256 end,uint256[5] memory gamma,uint256[5] memory high)external pure returns(uint256[5] memory){
  if(end==0||end>row.length/8||row.length%8!=0)revert Shape();uint256 n=end>512?512:end;return D.appendLower(high,D.projectBase(C.slice(row,(end-n)*8,n*8),gamma),n,gamma);
 }
 function claimTotals(uint256[5][21] memory p,uint256[5] memory gamma)external pure returns(uint256[5][2] memory){return D.claimTotals(p,gamma);}
 function reduce(uint256[5] memory gamma,uint256[5] memory zeta,uint256 index,uint256[5][2] memory claims,uint256[5][19] memory rows)external pure returns(uint256[5] memory){return D.reduce(gamma,zeta,index,claims,rows);}
 function reduceRows(bytes[] memory rows,uint256[5] memory gamma,uint256[5] memory zeta,uint256 index,uint256[5][2] memory claims)external pure returns(uint256[5] memory){
  if(rows.length!=19)revert Shape();uint256[5][19] memory projected;
  for(uint256 i;i<19;++i){if(rows[i].length!=D.rowWidth(i)*8)revert Shape();uint256 end=D.rowWidth(i);
   while(end!=0){uint256 n=end>512?512:end;projected[i]=D.appendLower(projected[i],D.projectBase(C.slice(rows[i],(end-n)*8,n*8),gamma),n,gamma);end-=n;}
  }return D.reduce(gamma,zeta,index,claims,projected);
 }
 function _u64(bytes memory b,uint256 off)private pure returns(uint256 v){for(uint256 j;j<8;++j)v|=uint256(uint8(b[off+j]))<<(8*j);}
 function _bytes(M.Digest memory d)private pure returns(bytes memory){return abi.encodePacked(d.a,d.b);}
}
/// @dev Stateless fixed MMCS/FRI implementation, runtime-pinned by the session.
contract WithdrawalSessionAuthentication {
 error Shape();
 function inputRows(M.Digest memory root,M.Kind kind,uint256 index,M.Opening memory proof)external view returns(M.Digest[] memory hashes){
  if(proof.rows.length!=1)revert Shape();uint256[] memory indices=new uint256[](1);indices[0]=index;M.verify(root,kind,16,indices,proof);hashes=new M.Digest[](proof.rows[0].length);for(uint256 i;i<hashes.length;++i)hashes[i]=_hash(proof.rows[0][i]);
 }
 function fri(uint256 round,uint256[5] memory beta,uint256[] memory indices,uint256[5][] memory carried,uint256[5][] memory siblings,M.Digest memory root,bytes[][] memory salts,M.Digest[] memory nodes)external view returns(uint256[] memory,uint256[5][] memory){return F.foldRound(round,beta,indices,carried,siblings,root,salts,nodes);}
 function _hash(bytes memory data)private view returns(M.Digest memory d){bytes memory b=H.hash(data);assembly("memory-safe"){mstore(d,mload(add(b,32)))mstore(add(d,32),mload(add(b,64)))}}
}
