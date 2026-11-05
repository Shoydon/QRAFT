// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Goldilocks5 as G} from "./Goldilocks5.sol";
import {Blake2b_512} from "./Blake2b_512.sol";

/// @notice Fixed WithdrawalAir constraint-folding primitive, not a STARK verifier.
/// @dev Callers must authenticate OOD openings/selectors/public values/alpha and the
/// previous accumulator and next batch index. No funds, authorization or session
/// state is implemented here. Program bytes are accepted only under fixed BLAKE2b-512
/// digests, pinned by batch index. Scalars are canonical Goldilocks; extension X^5=3.
contract AirProgram {
    uint256 public constant WIDTH = 2730;
    uint256 public constant PUBLIC_FIELDS = 96;
    uint256 public constant PREP_WIDTH = 6;
    uint256 public constant ROWS = 2048;
    uint256 public constant CONSTRAINT_COUNT = 3744;
    uint256 private constant P = 18446744069414584321;
    // BEGIN GENERATED AIR PINS
    uint256 public constant BATCH_COUNT = 93;
    uint256 public constant MAX_STACK = 7;
    uint256 public constant MAX_REGISTERS = 174;
    uint256 public constant MAX_PROGRAM_BYTES = 4060;
    bytes32 public constant PROGRAM_HASH_HI = 0x1b21f22835ef2488570291efee1907886c02d977330377c52e88e5099750ebc7;
    bytes32 public constant PROGRAM_HASH_LO = 0x64deb00dbc9d274e9803564382b001f9f3c54f9f411070a45cc2d259dbabaa91;
    bytes private constant DIGESTS = hex"3981b35d07bebcd6b8b93f96780da82999edf379e3e0c6b8f9dd1055828ad0fb3760aaba129c5a3865f590d25318e9f1cb3bc29d1fefe43635153166ead67871617bd65691f91e6fae7a964728b1cbba252253d67a72ffb9369a56eab8e5d7f82e0513dd784492ba3ae6d3017b7c1f44498491730455d42157c9e5f7c4f7fbed4a455f9b98f9c436e1e661f03c131e6a135a349a6514f283ec4fdd44e1c90d2886d97c7173fec5daca1521d0b6e4bd15d954a484f253575ca6656421981bd07fbe2d9181c702d3159622bebc19edcd0d93c6e6325e017b090dd74f82ab1e857d65a80c07309c375a6959829b0bc9a0b95de29689f94453d89b46f1f9dd8b683c3ef17c81341985b4e8e86508f143020a9e2dc621d5a6619305fd3e69f340987c5bf7dbdfcdf92bc10b0d34a939c798eb2c248a4979f17e4b6f88dce9a741f9c205b5435f1058e96c62cc5b1ba02cd151ac900ef12b707b9a62bf85b8e67bd2fc33950c354ca1da84210691c85244c06493376f8271150a6149b26f3ea0613c532b5b01b041bbb6bfa8243db3b05b1f77bc566157b5c8b108ff363301c2f420f4ba24e782271f4616c62c4467e7cfe4b75a53b040ec802f836b81645e4d600fe2d8dda9e71173fba6dcc92c6400485e6664fd76222c6e3d0793140a44867fb45f59a99def4771bafc0f6ae52ee373334240135734610fb18957785c2b96290cf240c72a764eb90fba91524d6a6ac2bb81be4ace35f178045baf204f47b4e52c62433536734fb2fa0faef1046d2fc154c7baddb39ab22740ab095d207cbd8e7be21c9a357b1520cece106689658363d47f89bf52521c1b5063f033d4753471155a21f849142c1eabccc6fd74b09340fe8bdf0f3038d0a2fba40aebd19dcb7b4111bab63912c1a5ef9bbfc4871d5690b7432e69893ba1a3dadcde7529229fa06b9d8a421d87bb6fc3aa5bfcb55c9537c18f1e578944dafc4573ba13ece9cb8030a23201210ff71b69f900ace0d6a513c3e182a3248b250eabb62fe98ebbb5dbf52810ed41d9e60451b5b3dbf833603a9766d45861e0638912577bc20a36bdc6cd6b96a90dc35d070e36333c09c4f7d3aeb21920af905de4fed14ecddf434a89f8975a7d18063281a1e8ac3ed55292e808586747ca3e902efcf7134ba4d7db4bd46561daed1f32561be14e368debb7bf91153bb2727dd1e4f00cc139a37166d7c30fa3396424ae0bfdd27750bd293020881e24822479d79b6b3e4f3f0dd8b08e6310a952bb3ac537d1163c462d647ab163b8c5b962383eacf58c3a9118725c8bdd07766e485083475a0ecf4c7055b733ad785dfdb612e88dd24147f5cdba8b20b28f9f78d12fe5a1fb47a71cfb15e45908cb8e0cdf674326cb5443fd9638dce0829130de0b60646ce33f5376f84d254eadf199b9b47462a8ec97f9bc6c07c068ea1c00664bb73b22102e1055ef35d99e45b79477d504d70dc817adbb5f3a4409bb369b4bf6cfbfcecba307369ec70d970c48f29cceda49bfa1c79b64310853790f8f13116f94ee68d132a7d8a1d109d9f0e33a92e1d9b6089bb1097d75315967bf69a984b42bcc4b68c34ac373b3bcfd7b2b125ac62d54902a63047cdb8c03e76bd1ded6975014a0ef943e4f888a7987656d2312abf1196ec6194d55cca19bd525f4b68f0c7a45b6a0469a287e8cc32e22bba21b40161663eb940a29d2cc0e35bb13a8098bc72b591fa9df8379f524ad7f8d78acee8a0705dfd0cc4ae04c8bb637d18acd500a39e1b78dbe6c6ed54e62be5829c7966d80a47cf3b246c7e4e4006c74cf85f8b791247eb94f6f20b4d43a0181d19c8f3480ded38e0ed8ac9ddbca50020bd5dadbe960805eebc472d4015595f51d806312c45e0ccaecb276bd196a6faa4d6682b91f84d4c5933eb3ac420c13e68c100f479786e375f29040e76afcc3752f921fdaefa142cb6cead2cd20a5de75621e94ae50a8b671c79e460f1db2b6c3bb4f9d0c444779518042d6a9320df4e2ca3cb5eb4f1291f68640eb2580bf4b1693de1270aa73d5194ca72daddc26b36be8ab39c1d99e8cb90d73aac2e272fb468739e581eac858cee6137e3a469e372bc9b9ce1b20318cb0a0c2af1954a6ad3aa01ee50a265e435b6568fb5bad1a448d2a5d9a40957d1f3719acde74f656829f134c566d82510ad34b2b67b8d7bdd260ed51065354dd1885497cd883a7e75f1dcae93b88ab2173b6397564a69f25dc4d4c5b0cef9ed5bee1cfb9e566423c089316b7c45b63de7f5ce0d59f8f3259c478196d6c4b4d4dc339eab97a2dddcc869abbfc0912bef0addf6bf0692a39439e6a5c7a51e6285ac8efb7935d6642ec820a738a0afb091f565155ca1a8fd06581349bdd237ac5af3848e6506e1bba022748732d2e4d1dc9755ab0b72580967b41262651b169c9b7a5c08ae7087a208d231f107161f32b55a38649c1ce5132f34b273132031e046388b43951c6f3a507e34cc41b700f975a779b95c68db0070348524ce8b34812e4de8c9ea1cc3090eee2cf1aaa988e022f2e6791e9b7d3742f0b135699e6e3ac3063c76796f3b96df2ca0dd7ee588bb7d590c3705a718b9d26064dadcef42a4b64978c149644faac8c69bd593ad35ebc69540f844934da03569e0238a0dc71cb82566371256980d4bbff8b4127da2a735376480285197df83495046c113ddd53fe124861c1a433242fe2a21182b3e4103c4c80c1a773c77b392cfe84102ba51ef29e4f0e0c4ae9f1a1c24760d97752448a20bdc0ddbfb4775d27ed2728274249e5633a489b181927f36ef2eec318c80059d6a6046b807d0551b6aa2d9e792efeb33eb23e193eeb39631df2d97ce6be9dc65e018c3b76fdddb6b920bab39625649f4bfdef3ac41b39a99f6f86b6fb97d27c24ac57fedf5e64948e8f3629f1aa60815885b6b205ee3b7c40f02514e39b98e7705942cb0a0f2020f427892ce593a8adfc01e110307a8318780f3596edb1a7375cbec5e04692be86fbd875c5444c4065317e90fc60845c126ddf17ded749a5b1f164bc2fca83e3928fda69ce44951d97ea5a2acef9c2c61835713005ae3a57099e8f525c493f0735f00c47e8efdc08abb3fb45f3f6f509a434243e7a0a5fc79af9f042a4d10d70ce87889f9a6428b6c5b50ceb7f668ebec2c10fea954d83e5e885c92188efba89362b4a443078490e410528a87ef51da62c9dab05c6c4bfc76bdaabb360a7b544720e57504787b8cf3b663b80e703f9fd232461722db82f6e2b8f6bec5ea2cb9bcef0d8a8d483cba82d440d4027b4f75720ec7ba2ac645c6d1d79f74183227831d0a0f038d799d59d0b13b0e827c93c95697696ee4a68d942131bca57156d6e2589be3ba7f5306ff110d510c7ce28988125c3f7f6a1f02bae92638f8c93add420c887febbb91d1d1d241981b159495678fb910d9401ff07fb0057fd11cb55bb83ec4a6a304857244331c900e9d177e55c4a4f93438660fd50bcc01a8b3046176b0978b65ed3e1f23c3477f1d8df0a6e2afa59448a35551797a13b9ee1a8e8f97beb3174a349adafdc2990ebfc6325ed6cfacff71999cd254ba5f7468d4c41b1cdc4968f0a057e19e9d46607ec7409f66040eff997e9e04ba27a3e079ad8825361fadd167d2863e838c1cdff0b9c129daac52eaef3c0ac6c85aa0e090d864cd43e43af6141f11d21b08cf66063e7ecf9677b4f25393f4c1e54cd81b02066c4b5dabf0b36bac107e9728a991148a6c62a9d2969f52a78e8f61a430ab7cddf74dcaccc8f79b45b3330cd2d556469b49610c26827fb3a78e4bb9cb1f5ebee0aaf884098ab950a4b156e447b4a836f1efe5d6295c78708702d732787ebb33ad9bfbd633574fd4819c7ccc52ed72d138e3c98bdc46d6f2c61d572962ba9a9349272d6124cc27d1aaff9f9a605dbef60b5712a979d28e60c633d47baf04d01521bcc4f3e2abdbd4ecf3f195b9523d4bdb65d7188d5f6ca4a81b9a7dc4801394c2968d2dcf0bf67e952c11fd1cf59b10be33ec28127a9f585ad4953d9a9b94c3d86dec260369d470c429f32ddcbfb4cc0888ca717b42b9c5169201a940421e726af0f5890c20776be0ee4ddf2fdafee33f68866d6c2f3d0e773903143a1e4e8cae2db835cf2c5c0287d5a4354ad4c00d55d4c5c2b175570188b35c083fb31953edc4cd6dac50286daa1b5dc419a445f147776c56f972784a37855869a2d544f717b3667b2ad022a129e4178b470ab0c4c3bf22b5ffb2eb9f7d5cd31fcb73bae555b68c40f48e98ed83fd1a59bdb867751705d9dcf94434d2dcc7e113ca047b2dd816b315df8f63f4a5e059e31606e9793c576814928ba8ab7c11aa95e7e9e1a9b7b48ba95cee780d2e568affae05442d38c092f891195228a524b6d5e581f6358e1f9c9fdb7bd0b982afa6d9dfd3001e8d1675091e3ee5dd2883b86bf3e85588401b97509890d43c1933b66229835975b25ce504f9e9e95203ce3ea3e70d6c99c947a02df976862d1ee21e1c753248281b70cdff71526542f17f40a69fda7476e1bee4b5d6147d1f63ef9c6f25bf8c527726fbea1d9900ac2e07bd231a94c79025b9740c3324bac5d1517e6b69d2bca311916224ac6c520e9fb1c69f715e4b19dabf9b08f599ddcf33d53a191044e33c9181b89f183be790a7903aa9746072591c6ae0d134da398a627b01c59ab6b6dc2bb5c8dbbd80d420bfe623d9c63809ca135a544cca47a1fb5ca6ac9a94c54e7ddc688ce55d7d7843861ac523d1a83d8cf496b1ab64885aee276863023882bacab7ee345b00586771c16e44a167c611b20fa427a34233bd69ea11d5f7ffdf6d8d0a9316c0a704308940f17a7fea0a7dcfd5e28e45e3bafdc5aa2a4d0b6154ae8b96d9eac87481bfe4b68a551daaa1d11d7089bda74f3c1156b94160b29069fcc5a7b8bb2a8beaca2c3e2c22028e69564b4055f6fda6c479a94a625877f8a663ac18d2ae59f1ccbcf6feb15361ee65c0339fe37f574b9f8ccee05e32fc90b26cc28a4cf89986063b2c448c1327b2665bb5d2dad3528134be6fd271fde789684e6e944daeedc46cdbee8384850a109822ebbffa99548450748a15577e3807ce40803712df902405d685be4877127c285501ac89f35f467ac09a9285169bc8a82ec6d31e85cb15a9ea47f8faf7b556a67dc4afb440c5c97fd369fd6c526034d7fdd4f9dae2dff78ef5538461a10fdd379f4c54df2c026301db61b848c743e677f2253d9d9eba2024dda6eb7dcf96423dfb655e15e7c006543d9dad4a1c69a293f64762f9f45683a8a1b479b8fc6059571ed83b6d3f805a9bd4b600a2af931628def1acbdfbb8b05aa252256f3eb0669aaa4c22b0f0f73dbaa519aa612d814c1929aca1148465a96e40d0a4af74ac2a5f1ad4f238987c55c94d74ee74fc5878540707a6b2a40547cfe02202bd1ce8f9e1898d97d59749e15deb4f04c290ac5c30220ab29ec827e72e124239296e6650167e1eeda19b7f5c3af2e515ea80c325d9ad5f6606dafcd19604bde87c3cef8c9aa99cbfc915522ad3e9e62ff693d35c21f490c779d21751a46ecd09450c43030949da1dea3b3ca6c0285273662f817c5d392845d76aafd689f0612fd3ef455fe4998e01bc009d9b4dcef251818d5cb18ff46d52cfffc57f2a041ab9772a1a568fd2765c8254feeedcc8a92e8211cc08a9b92fa0fc73a80984c83cffcc2356cfc5222f974c42e9480a239db1cc977475878269f7127bd32b1f93a76f063e1510886ad0b31b2c7353d2424a60c6a94af9a47e75223058dfd5c3e94732742970f235b6bd1417e29597d36153fdfaa41de483626dac973e5f84b4a0327cbb6feeae53dc881f5de577e4a532683ce8c6cb2d291158cebecf72293b626e41fc104f01109e77b9ec2704bdc811dd84c8b799fcf03e5d8347a1f9622318643d9c371ac39459371fa700ae8b4016541119672f05d7bef32cfbcba52d990fc4e1d1194ddb334455a70f2502694ddd41581150caac4f87ef0a3d7d02d5a43f44ea9a9ab014a0c6d50b4a10679356f9b25d042b46c5d180d4172b80d3f72582d875fc526414729277849feb3e744dff9e6020ab1aa7804c875f43a954cb574345e98bc3789ec3898c27a057f08930f79148d352314a36ec1041acd529fe3d422fb5dca9ef31b5c4518ccb3efb1c93cd1c61cd15c80a3acc0b216f4f3aba1f8c9caa2f74888d2f47d91ca465976c8e5264220fe77ddc2012660c7737532fe0a0e70cd2b7f8c855d05a796033e863410f1a211c9f8aae7dcb377db6a5064c1a1dd6c725e943cce2b0aa456cc9520c146ac3ab8488bcca796c5586e67798224f9d8da78aa84059e50ddbf3c6335e464c0665a121c828cdb336dc460ac3df608ba73473655909a965a4fa4b85c8257bfc94b76d829807b1cc41ddc1772f8cb530b1c559a8b89f22804a8fc4356e062ce4ec38296113e380ea3c694227fcacb9122324bc01800404540f81a1a163372b479dd6bad8e59c314e0c5a069b9950951345f90038dde20fad6b49432b3387e8e0cf0b545d86dbcaa9125dbda0ac983feb27e520d1a4e7648d230900ac16ff41a74bb92bea96bb13121d7c96b07124b642d8eefa4dcc900661fed7af6c2d0ef3531495b08daed57db738f1e60e6433e65ecab5e9c8bbd0c68c6a5f47be293131dbce3644dda38f2e2df1eb8d01cf7c5f467e62d0b1523b328b7ad5ba00f450a2ad4aa9bbf21d7a788a40b3d0b412c1834c2075edccbb86e73486d4acb3eeaf86c4d05485da68c7e665264fefa7c7d81b5e17d2e8ea7c5191e293cb6205383e764bae2f05e21bdbc0ce6515e861447414f604a943232d3b1a1f29513e46288d49f2f8764ee2f13d34aeb8f551e8841caf1240b94e7bd79cabe151c5b4a016dbfbdb7738af8cfad93ee2a6646b83a452f368bda598c1b2ee8477906b6de6359205f23d19b030318ffaf9c1818ac5aca86f9d0353fbba92915055b2310e71ac7790a854650f2f77d5e579191b295afc02589bf5ced393c3cfcfc31368a96f7046371be124d1d98315a704c17a76a37401cff03eb46de9996acff80250679278b5b570ea83fcdb2f4f5ad4241d8d063f85306a553227f53b9ac7e490bcb11634a17ac69883d3e2811ef2a3eb99d7ea49a6ffefb7d4323601f2237ccfdc49c282699ac50f9df82ddd67eede021b8340d7e9af4bd9702c427170604398b2dabfef7c3c9613bbfd099df5a0e80de9eda9d8e49c82eff549ba8afbdfd350f384b301ca2f6ab9221892b6dd29effd77b49989fdd46dac57b03645422eb7203b275fe902f744759562b59d984f419e98eda500dbb4f7a227a8ed7e826a58b61607292017f8a2ec072fd3e79d5bc453b9de64ee337bee28e0285f978dcd26505c41d51cd895ea99b71c2d80c8efc7c85a1a9ab12ba242a3806cb63a76dccd8b3f42378758fce27dd4f7a24d3293927e9652eec6d39d25931773a306c7d7c61ca198b4c072224770706dde8b748c17ad0f448fe2c19923405e6c1fe5f3440f867021935c3ee6e4e102f4dc2ace28ea66830c7a7f2c0bf6f88a0a031b7f941c4169cc99832210e8492020c4283bf46002522e2d3ef685b044b01a1115a7a3c445433b1b18e0382a064f645da2b396c91410d2ba3ad738780da2f38da144a2f9962ca4dc019079a2ea6d4f995c72c2926abfc6b4acca26c7f5e9c5ba59626e88bef7d594aa93210dbf740ad20c627207c41ccff74d2f3ff1a1a871b5f71c2dc02f895d477a9ceae7f2c0a219ecdff0839361d2c7798f857c43bf54761689abafe0aa4e9219c16551b1f9223d6617ce8060244842c4d284bf9f5feeaa59db9254e4c280441cf05fb697a8929c0ce5a438e99b5705efdcfad59794ff6ada0348f7d93f3bf29db91c67a3c2d3fa14f650e074493f59e0c7387e92631398d33013bcbe3778f59196c9629dd8b567d82466001b18b256c9bf5510d81c43488c5dd69a1a83839a9f72b63e926871d606030f6d2af013bcb680362ddb12c33944438485e3470a21e2a4f4d0645210eaf17c7eea9af6ed6331f23534552eeea5da5f6e814f1d5af82ffe588f1d02caea8be7cb8a55bed2e2aaedbd6f079b7dbe81cb2dda6843cde362c554a88fe42f948d90714b24acaf172a107dc1ad77254dfc4159c12a138e1537374ab334479182c5571503f94c2c0519de0805c83ccf9b8bfb9a706ca4e64c706939278d90f657e755cc8fdd6ac689c0e94a7db340123707c7b5a60980c3412ac853a6869bb3cb2d0431f7544611c56d803e12c498597d1ac968b30170a41e949c2cfeca2627fe85d42e5e44186d2a26cc82d6848c23bb7a8a0079dc9cc6d5048379f70b1e4c997bae498b4f52d2789528ce1d3cd6972db51d0b2360dabbe4a8d2e9e20aa093c1477faae86fa3d088f75b261bb85";
    bytes private constant BATCH_META = hex"00000040024a00400040030000800040030f00c000400338010000400516014000400a2a01800040051601c000400a2a020000400516024000400a2a02800040051602c000400a2a030000400516034000400a2a038000400fac03c000400a16040000400a16044000400fac048000400fac04c000400fac050000400fac054000400fac058000400fac05c000400fac060000400fac064000400fac068000400fac06c000400fac070000400fac074000400fac078000400fac07c000400fac080000400a16084000400a16088000400fac08c000400fac090000400fac094000400fac098000400fac09c000400fac0a00002a0fdc0a2a00400dc00a6a00400dc00aaa00400dc00aea00400dc00b2a00350de90b5f00050db10b6400050db10b6900050db10b6e00050db10b7300050db10b7800050db10b7d00050db10b8200050db10b8700050db10b8c00050db10b9100050db10b9600050db10b9b00050db10ba000050db10ba500050db10baa00050db10baf00050db10bb400050db10bb900050db10bbe00400f2c0bfe004009390c3e004002cf0c7e004002300cbe004004250cfe0040022c0d3e004004400d7e00400a510dbe00030ea40dc100020cba0dc300020cba0dc500020cba0dc700020cba0dc900020cba0dcb00020cba0dcd00020cba0dcf00020cba0dd100020cba0dd300020cba0dd500020cba0dd700020cb40dd900020c9a0ddb00020c9a0ddd00020c9a0ddf0040094b0e1f004003000e5f004002820e9f0001000a";
    // END GENERATED AIR PINS
    error WrongShape();
    error WrongBatch();
    error WrongProgram();
    error InvalidProgram();

    struct Values {
        uint256[5][] mainLocal;
        uint256[5][] mainNext;
        uint256[5][] prepLocal;
        uint256[5][] prepNext;
        uint256[96] publicValues;
        // first-row, last-row, transition selectors at the OOD point.
        uint256[5][3] selectors;
    }

    function batchMetadata(uint256 index) public pure returns
        (uint256 first, uint256 count, uint256 length, bytes32 hi, bytes32 lo)
    {
        if (index >= BATCH_COUNT) revert WrongBatch();
        bytes memory digests = DIGESTS;
        assembly ("memory-safe") {
            hi := mload(add(add(digests,32),mul(index,64)))
            lo := mload(add(add(digests,64),mul(index,64)))
        }
        bytes memory meta = BATCH_META;
        first = _u16m(meta,6*index);
        count = _u16m(meta,6*index+2);
        length = _u16m(meta,6*index+4);
    }
    function _u16m(bytes memory b, uint256 p) private pure returns(uint256) {
        return uint256(uint8(b[p]))*256+uint8(b[p+1]);
    }
    function _u16(bytes calldata b, uint256 p) private pure returns(uint256) {
        if(p+2>b.length) revert InvalidProgram();
        return uint256(uint8(b[p]))*256+uint8(b[p+1]);
    }
    uint256 public constant PACKED_BYTES = (2*WIDTH*5+2*PREP_WIDTH*5+PUBLIC_FIELDS+15)*8;
    /// Fixed wire order: local, next, prep-local, prep-next, public, selectors;
    /// field elements are canonical LE-u64; extension limbs are ascending powers.
    function _u64(bytes calldata input,uint256 pos) private pure returns(uint256 r) {
        assembly ("memory-safe") {
            let v:=shr(192,calldataload(add(input.offset,pos)))
            v:=or(shl(8,and(v,0x00ff00ff00ff00ff)),shr(8,and(v,0xff00ff00ff00ff00)))
            v:=or(shl(16,and(v,0x0000ffff0000ffff)),shr(16,and(v,0xffff0000ffff0000)))
            r:=or(shl(32,and(v,0x00000000ffffffff)),shr(32,v))
        }
    }
    function _ext(bytes calldata v,uint256 pos) private pure returns(uint256[5] memory r) {
        for(uint256 i;i<5;++i)r[i]=_u64(v,pos+8*i);
    }
    function _checkValues(bytes calldata v) private pure {
        if(v.length!=PACKED_BYTES)revert WrongShape();
        uint256 selector=uint32(G.NonCanonical.selector);
        assembly ("memory-safe") {
            let end:=add(v.offset,v.length)
            for {let pos:=v.offset} lt(pos,end) {pos:=add(pos,8)} {
                let x:=shr(192,calldataload(pos))
                x:=or(shl(8,and(x,0x00ff00ff00ff00ff)),shr(8,and(x,0xff00ff00ff00ff00)))
                x:=or(shl(16,and(x,0x0000ffff0000ffff)),shr(16,and(x,0xffff0000ffff0000)))
                x:=or(shl(32,and(x,0x00000000ffffffff)),shr(32,x))
                if iszero(lt(x,18446744069414584321)) {mstore(0,shl(224,selector)) revert(0,4)}
            }
        }
    }

    /// @notice Continue the native Horner fold: acc = acc*alpha + next_constraint.
    /// @return result Accumulator after this fixed contiguous constraint batch.
    /// @return nextBatch Required next batch number for a future authenticated session.
    function foldBatch(uint256 index, bytes calldata program, bytes calldata v,
        uint256[5] calldata alpha, uint256[5] calldata accumulator)
        external view returns(uint256[5] memory result,uint256 nextBatch)
    {
        (,uint256 count,uint256 length,bytes32 hi,bytes32 lo)=batchMetadata(index);
        if(program.length!=length || program.length>MAX_PROGRAM_BYTES) revert WrongProgram();
        bytes memory digest=Blake2b_512.hash(program);
        bytes32 actualHi;bytes32 actualLo;
        assembly ("memory-safe") {actualHi:=mload(add(digest,32)) actualLo:=mload(add(digest,64))}
        if(actualHi!=hi || actualLo!=lo) revert WrongProgram();
        _checkValues(v);G.check(alpha);G.check(accumulator);
        result=_run(program,v,alpha,accumulator,count);
        nextBatch=index+1;
    }
    function _run(bytes calldata program,bytes calldata v,uint256[5] memory alpha,
        uint256[5] memory accumulator,uint256 count) private pure returns(uint256[5] memory)
    {
        uint256[5][] memory stack=new uint256[5][](MAX_STACK);
        uint256[5][] memory registers=new uint256[5][](MAX_REGISTERS);
        uint256 top;uint256 pos;uint256 written;uint256 folds;
        while(pos<program.length){
            uint256 op=uint8(program[pos++]);
            if(op<=4){
                uint256 col=_u16(program,pos);pos+=2;
                if(top>=MAX_STACK) revert InvalidProgram();
                if(op==0){if(col>=WIDTH)revert InvalidProgram();stack[top]=_ext(v,col*40);}
                else if(op==1){if(col>=WIDTH)revert InvalidProgram();stack[top]=_ext(v,(WIDTH+col)*40);}
                else if(op==2){if(col>=PREP_WIDTH)revert InvalidProgram();stack[top]=_ext(v,(2*WIDTH+col)*40);}
                else if(op==3){if(col>=PREP_WIDTH)revert InvalidProgram();stack[top]=_ext(v,(2*WIDTH+PREP_WIDTH+col)*40);}
                else {if(col>=PUBLIC_FIELDS)revert InvalidProgram();stack[top]=G.fromBase(_u64(v,(2*WIDTH*5+2*PREP_WIDTH*5+col)*8));}
                ++top;
            } else if(op<=7){
                if(top>=MAX_STACK)revert InvalidProgram();stack[top++]=_ext(v,(2*WIDTH*5+2*PREP_WIDTH*5+PUBLIC_FIELDS+(op-5)*5)*8);
            } else if(op==8){
                if(pos+8>program.length || top>=MAX_STACK)revert InvalidProgram();
                uint256 c=uint64(bytes8(program[pos:pos+8]));pos+=8;
                stack[top++]=G.fromBase(c);
            } else if(op==11){
                if(top==0)revert InvalidProgram();stack[top-1]=G.neg(stack[top-1]);
            } else if(op==9 || op==10 || op==12){
                if(top<2)revert InvalidProgram();--top;
                if(op==9)stack[top-1]=G.add(stack[top-1],stack[top]);
                else if(op==10)stack[top-1]=G.sub(stack[top-1],stack[top]);
                else stack[top-1]=G.mul(stack[top-1],stack[top]);
            } else if(op==13){
                if(top!=1 || folds>=count)revert InvalidProgram();
                accumulator=G.add(G.mul(accumulator,alpha),stack[0]);top=0;++folds;
            } else if(op==14 || op==15){
                uint256 reg=_u16(program,pos);pos+=2;
                if(op==14){
                    if(top==0 || reg!=written || reg>=MAX_REGISTERS)revert InvalidProgram();
                    registers[written++]=stack[top-1];
                } else {
                    if(reg>=written || top>=MAX_STACK)revert InvalidProgram();stack[top++]=registers[reg];
                }
            } else revert InvalidProgram();
        }
        if(top!=0 || folds!=count)revert InvalidProgram();
        return accumulator;
    }
}
