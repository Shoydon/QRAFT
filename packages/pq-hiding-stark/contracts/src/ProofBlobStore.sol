// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Permissionless storage for PUBLIC proof material, using immutable STOP-prefixed code.
/// @dev Sealing certifies complete ordered bytes, not proof validity. Consumers MUST bind the
/// actual read bytes to their fixed statement/material using full BLAKE2b-512 commitments.
/// No private witnesses or signing keys belong here. No caller-selected code/address is accepted.
contract ProofBlobStore {
    uint256 public constant MAX_BLOB_BYTES=1<<20;
    // <=16KiB, with headroom under16,777,216 transaction gas even at1530stateGas/codeByte.
    uint256 public constant MAX_CHUNK_BYTES=8192;
    uint256 public nextBlobId=1;
    struct Chunk {address location;uint32 length;}
    struct Blob {address owner;uint32 totalLength;uint32 written;bool complete;Chunk[] chunks;}
    mapping(uint256=>Blob)private blobs;
    error UnknownBlob();error NotOwner();error WrongLength();error AlreadySealed();error NotSealed();error CreateFailed();error Range();
    event Begun(uint256 indexed blobId,address indexed owner,uint256 totalLength);
    event Appended(uint256 indexed blobId,address indexed location,uint256 length,uint256 written);
    event Sealed(uint256 indexed blobId,uint256 totalLength);

    function begin(uint256 totalLength)external returns(uint256 id){
        if(totalLength==0 || totalLength>MAX_BLOB_BYTES)revert WrongLength();
        id=nextBlobId++;Blob storage b=blobs[id];b.owner=msg.sender;b.totalLength=uint32(totalLength);
        emit Begun(id,msg.sender,totalLength);
    }
    function append(uint256 id,bytes calldata data)external returns(address location){
        Blob storage b=owned(id);if(b.complete)revert AlreadySealed();
        uint256 n=data.length;uint256 remaining=uint256(b.totalLength)-b.written;
        uint256 expected=remaining>MAX_CHUNK_BYTES?MAX_CHUNK_BYTES:remaining;
        // Canonical full-size chunks except the final remainder: at most128chunks per blob.
        if(n==0 || n!=expected)revert WrongLength();
        // Fixed10byte initialization: PUSH2 size; DUP1; PUSH1 10; PUSH0; CODECOPY;
        // PUSH0; RETURN. It copies STOP||data without executing ANY data bytes.
        bytes memory initcode=abi.encodePacked(hex"61",bytes2(uint16(n+1)),hex"80600a5f395ff3",hex"00",data);
        assembly("memory-safe"){location:=create(0,add(initcode,32),mload(initcode))}
        if(location==address(0) || location.code.length!=n+1)revert CreateFailed();
        b.chunks.push(Chunk(location,uint32(n)));b.written+=uint32(n);
        emit Appended(id,location,n,b.written);
    }
    function seal(uint256 id)external{
        Blob storage b=owned(id);if(b.complete)revert AlreadySealed();if(b.written!=b.totalLength)revert WrongLength();
        b.complete=true;emit Sealed(id,b.totalLength);
    }
    function length(uint256 id)external view returns(uint256){return existing(id).totalLength;}
    function isSealed(uint256 id)external view returns(bool){return existing(id).complete;}
    function info(uint256 id)external view returns(address owner,uint256 totalLength,uint256 written,bool complete,uint256 chunks){
        Blob storage b=existing(id);return(b.owner,b.totalLength,b.written,b.complete,b.chunks.length);
    }
    function chunk(uint256 id,uint256 index)external view returns(address location,uint256 size){
        Blob storage b=existing(id);if(index>=b.chunks.length)revert Range();Chunk storage c=b.chunks[index];return(c.location,c.length);
    }
    function read(uint256 id)external view returns(bytes memory){Blob storage b=existing(id);return readPart(b,0,b.totalLength);}
    function readSlice(uint256 id,uint256 offset,uint256 size)external view returns(bytes memory){return readPart(existing(id),offset,size);}
    function readPart(Blob storage b,uint256 offset,uint256 size)private view returns(bytes memory out){
        if(!b.complete)revert NotSealed();if(offset>b.totalLength || size>uint256(b.totalLength)-offset)revert Range();
        out=new bytes(size);uint256 copied;uint256 start;
        for(uint256 i;i<b.chunks.length && copied<size;++i){
            Chunk storage c=b.chunks[i];uint256 n=c.length;
            if(offset>=start+n){start+=n;continue;}
            uint256 localOffset=offset>start?offset-start:0;
            uint256 take=n-localOffset;if(take>size-copied)take=size-copied;
            address location=c.location;
            assembly("memory-safe"){extcodecopy(location,add(add(out,32),copied),add(1,localOffset),take)}
            copied+=take;offset+=take;start+=n;
        }
        assert(copied==size);
    }
    function existing(uint256 id)private view returns(Blob storage b){b=blobs[id];if(b.owner==address(0))revert UnknownBlob();}
    function owned(uint256 id)private view returns(Blob storage b){b=existing(id);if(b.owner!=msg.sender)revert NotOwner();}
}
