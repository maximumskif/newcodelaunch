"""wallet nonce message

Revision ID: 9c4f2e81b7a3
Revises: 5b1e7c9a2d40
Create Date: 2026-10-30 12:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9c4f2e81b7a3'
down_revision = '5b1e7c9a2d40'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('wallet_nonces', schema=None) as batch_op:
        batch_op.add_column(sa.Column('message', sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table('wallet_nonces', schema=None) as batch_op:
        batch_op.drop_column('message')
