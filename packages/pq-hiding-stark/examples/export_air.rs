//! Export the fixed WithdrawalAir relation and native differential fixtures.
//! Local research utility; never exports a private witness or deploys anything.
use qraft_direct_hiding_research::{
    authorization::{PUBLIC_FIELDS, WIDTH, WithdrawalAir},
    blake_config::{Challenge as EF, Config, Val as F},
};
use p3_air::{
    Air, AirLayout, RowWindow, SymbolicExpression,
    symbolic::{BaseEntry, BaseLeaf, get_max_constraint_degree, get_symbolic_constraints},
};
use p3_field::{BasedVectorSpace, PrimeCharacteristicRing, PrimeField64};
use p3_matrix::{dense::RowMajorMatrixView, stack::VerticalPair};
use p3_uni_stark::VerifierConstraintFolder;
use serde_json::{Value, json};
use std::{collections::HashMap, error::Error, fs, path::PathBuf};

// Fixed operation tags shared with compile-air.py, not caller-defined code.
// 0 main local,1 main next,2 prep local,3 prep next,4 public,
// 5 first,6 last,7 transition,8 constant,9 add,10 sub,11 neg,12 mul.
fn intern(
    e: &SymbolicExpression<F>,
    nodes: &mut Vec<Vec<u64>>,
    cache: &mut HashMap<Vec<u64>, usize>,
) -> usize {
    let n = match e {
        SymbolicExpression::Leaf(v) => match v {
            BaseLeaf::Variable(v) => vec![
                match v.entry {
                    BaseEntry::Main { offset: 0 } => 0,
                    BaseEntry::Main { offset: 1 } => 1,
                    BaseEntry::Preprocessed { offset: 0 } => 2,
                    BaseEntry::Preprocessed { offset: 1 } => 3,
                    BaseEntry::Public => 4,
                    _ => panic!("unsupported symbolic variable"),
                },
                v.index as u64,
            ],
            BaseLeaf::IsFirstRow => vec![5],
            BaseLeaf::IsLastRow => vec![6],
            BaseLeaf::IsTransition => vec![7],
            BaseLeaf::Constant(v) => vec![8, v.as_canonical_u64()],
        },
        SymbolicExpression::Add { x, y, .. } => vec![
            9,
            intern(x, nodes, cache) as u64,
            intern(y, nodes, cache) as u64,
        ],
        SymbolicExpression::Sub { x, y, .. } => vec![
            10,
            intern(x, nodes, cache) as u64,
            intern(y, nodes, cache) as u64,
        ],
        SymbolicExpression::Neg { x, .. } => vec![11, intern(x, nodes, cache) as u64],
        SymbolicExpression::Mul { x, y, .. } => vec![
            12,
            intern(x, nodes, cache) as u64,
            intern(y, nodes, cache) as u64,
        ],
    };
    if let Some(i) = cache.get(&n) {
        return *i;
    }
    let i = nodes.len();
    cache.insert(n.clone(), i);
    nodes.push(n);
    i
}
fn next(s: &mut u64) -> u64 {
    *s = s.wrapping_add(0x9e3779b97f4a7c15);
    let mut z = *s;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    z ^ (z >> 31)
}
fn extension(s: &mut u64) -> EF {
    EF::from_basis_coefficients_fn(|_| F::from_u64(next(s)))
}
fn limbs(v: EF) -> Vec<u64> {
    v.as_basis_coefficients_slice()
        .iter()
        .map(|x: &F| x.as_canonical_u64())
        .collect()
}
fn fixture(seed: u64, constraints: &[SymbolicExpression<F>]) -> Value {
    let mut state = seed;
    let local: Vec<EF> = (0..WIDTH).map(|_| extension(&mut state)).collect();
    let next_row: Vec<EF> = (0..WIDTH).map(|_| extension(&mut state)).collect();
    let prep_local: Vec<EF> = (0..6).map(|_| extension(&mut state)).collect();
    let prep_next: Vec<EF> = (0..6).map(|_| extension(&mut state)).collect();
    let public: Vec<F> = (0..PUBLIC_FIELDS)
        .map(|_| F::from_u64(next(&mut state)))
        .collect();
    let first = extension(&mut state);
    let last = extension(&mut state);
    let transition = extension(&mut state);
    let alpha = extension(&mut state);
    let mut folder = VerifierConstraintFolder::<Config> {
        main: VerticalPair::new(
            RowMajorMatrixView::new(&local, WIDTH),
            RowMajorMatrixView::new(&next_row, WIDTH),
        ),
        preprocessed: VerticalPair::new(
            RowMajorMatrixView::new(&prep_local, 6),
            RowMajorMatrixView::new(&prep_next, 6),
        ),
        preprocessed_window: RowWindow::from_two_rows(&prep_local, &prep_next),
        periodic_values: &[],
        public_values: &public,
        is_first_row: first,
        is_last_row: last,
        is_transition: transition,
        alpha,
        accumulator: EF::ZERO,
    };
    // Actual native AIR evaluation is independent of the exported DAG evaluator.
    WithdrawalAir.eval(&mut folder);
    let expected = folder.accumulator;
    let mut fold = EF::ZERO;
    let mut prefixes = vec![limbs(fold)];
    let mut values = Vec::new();
    for (i, c) in constraints.iter().enumerate() {
        let value = c.resolve(&folder);
        values.push(limbs(value));
        fold = fold * alpha + value;
        if (i + 1) % 64 == 0 || i + 1 == constraints.len() {
            prefixes.push(limbs(fold));
        }
    }
    assert_eq!(
        fold, expected,
        "symbolic order differs from native VerifierConstraintFolder"
    );
    json!({"seed":seed,"local":local.into_iter().map(limbs).collect::<Vec<_>>(),"next":next_row.into_iter().map(limbs).collect::<Vec<_>>(),"prepLocal":prep_local.into_iter().map(limbs).collect::<Vec<_>>(),"prepNext":prep_next.into_iter().map(limbs).collect::<Vec<_>>(),"public":public.iter().map(|x|x.as_canonical_u64()).collect::<Vec<_>>(),"selectors":[limbs(first),limbs(last),limbs(transition)],"alpha":limbs(alpha),"fold":limbs(expected),"batch64Prefixes":prefixes,"constraintValues":values})
}
fn main() -> Result<(), Box<dyn Error>> {
    let out = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local/pq-air-export"));
    fs::create_dir_all(&out)?;
    let air = WithdrawalAir;
    let layout = AirLayout::from_air::<F>(&air);
    assert_eq!(WIDTH, 2730);
    assert_eq!(PUBLIC_FIELDS, 96);
    assert_eq!(layout.preprocessed_width, 6);
    let constraints = get_symbolic_constraints::<F, _>(&air, layout);
    assert_eq!(constraints.len(), 3744);
    let degree = get_max_constraint_degree::<F, _>(&air, layout, 2048);
    assert_eq!(degree, 7);
    let mut nodes = Vec::new();
    let mut cache = HashMap::new();
    let roots: Vec<_> = constraints
        .iter()
        .map(|c| intern(c, &mut nodes, &mut cache))
        .collect();
    let ast = json!({"format":"QRAFT-WITHDRAWAL-AIR-DAG-v1","upstream":"0d803737b681774186cd283b1fd2d8e493655c82","fieldModulus":"18446744069414584321","extension":"X^5-3","width":WIDTH,"publicFields":PUBLIC_FIELDS,"prepWidth":6,"rows":2048,"degree":degree,"constraintCount":constraints.len(),"nodes":nodes,"constraints":roots,"fold":"acc = acc * alpha + constraint; native assertion order","batchConstraints":64});
    fs::write(out.join("withdrawal-air.json"), serde_json::to_vec(&ast)?)?;
    for (i, seed) in [1u64, 0xfeedbeef, 0xffffffffffffffff]
        .into_iter()
        .enumerate()
    {
        fs::write(
            out.join(format!("ood-{i}.json")),
            serde_json::to_vec(&fixture(seed, &constraints))?,
        )?;
    }
    println!(
        "Exported {} constraints / {} DAG nodes / degree{} to {}",
        constraints.len(),
        nodes.len(),
        degree,
        out.display()
    );
    Ok(())
}
